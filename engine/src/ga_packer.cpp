#include "engine_types.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <random>
#include <tuple>
#include <unordered_set>

namespace engine {

namespace {

double volume(double w, double h, double d) { return w * h * d; }

struct AABB {
  double x;
  double y;
  double z;
  double w;
  double h;
  double d;
};

struct Candidate {
  double x;
  double y;
  double z;
};

struct PlacedState {
  AABB box;
  std::string id;
  double weight;
  double max_load;
  double load_on_top;
};

constexpr double kEps = 1e-8;
constexpr double kMinSupportRatio = 0.90;      // >= 90% of base area must be supported
constexpr double kMaxStackMultiplier = 6.0;    // max load proportional to box weight
constexpr double kMaxPressure = 2500.0;        // kg per m^2 (simple crush proxy)

bool intersects(const AABB& a, const AABB& b) {
  const bool sep_x = (a.x + a.w <= b.x) || (b.x + b.w <= a.x);
  const bool sep_y = (a.y + a.h <= b.y) || (b.y + b.h <= a.y);
  const bool sep_z = (a.z + a.d <= b.z) || (b.z + b.d <= a.z);
  return !(sep_x || sep_y || sep_z);
}

bool inside_truck(const Truck& t, const AABB& b) {
  return b.x >= 0 && b.y >= 0 && b.z >= 0 && (b.x + b.w) <= t.w && (b.y + b.h) <= t.h && (b.z + b.d) <= t.d;
}

double overlap_1d(double a0, double a1, double b0, double b1) {
  const double lo = std::max(a0, b0);
  const double hi = std::min(a1, b1);
  return std::max(0.0, hi - lo);
}

double overlap_area_xz(const AABB& top, const AABB& bottom) {
  const double ox = overlap_1d(top.x, top.x + top.w, bottom.x, bottom.x + bottom.w);
  const double oz = overlap_1d(top.z, top.z + top.d, bottom.z, bottom.z + bottom.d);
  return ox * oz;
}

bool point_in_overlap_xz(double px, double pz, const AABB& top, const AABB& bottom) {
  const double x0 = std::max(top.x, bottom.x);
  const double x1 = std::min(top.x + top.w, bottom.x + bottom.w);
  const double z0 = std::max(top.z, bottom.z);
  const double z1 = std::min(top.z + top.d, bottom.z + bottom.d);
  return (px + kEps) >= x0 && (px - kEps) <= x1 && (pz + kEps) >= z0 && (pz - kEps) <= z1;
}

double max_load_for(double weight, double base_area) {
  // Capacity is limited by BOTH a weight-proportional heuristic and a simple
  // pressure proxy; use the stricter one.
  const double by_weight = weight * kMaxStackMultiplier;
  const double by_pressure = base_area * kMaxPressure;
  return std::max(kEps, std::min(by_weight, by_pressure));
}

bool support_ok_and_apply_load(const AABB& candidate,
                               double weight,
                               std::vector<PlacedState>& placed,
                               std::vector<std::pair<size_t, double>>* applied) {
  if (candidate.y <= kEps) {
    return true;
  }

  const double base_area = std::max(kEps, candidate.w * candidate.d);
  const double cx = candidate.x + candidate.w / 2.0;
  const double cz = candidate.z + candidate.d / 2.0;

  double supported_area = 0.0;
  bool centroid_supported = false;

  std::vector<std::pair<size_t, double>> supports;

  for (size_t i = 0; i < placed.size(); ++i) {
    const auto& s = placed[i];
    const double top_y = s.box.y + s.box.h;
    if (std::fabs(top_y - candidate.y) > 1e-6) {
      continue;
    }
    const double area = overlap_area_xz(candidate, s.box);
    if (area <= kEps) {
      continue;
    }
    supported_area += area;
    supports.push_back({i, area});
    if (!centroid_supported && point_in_overlap_xz(cx, cz, candidate, s.box)) {
      centroid_supported = true;
    }
  }

  if (!centroid_supported) {
    return false;
  }

  if (supported_area + 1e-9 < kMinSupportRatio * base_area) {
    return false;
  }

  // Check crush limits for each supporting box using area-weight share.
  for (const auto& [idx, area] : supports) {
    const double share = std::min(1.0, std::max(0.0, area / base_area));
    const double added = weight * share;
    if (placed[idx].load_on_top + added > placed[idx].max_load + 1e-9) {
      return false;
    }
  }

  // Apply loads.
  for (const auto& [idx, area] : supports) {
    const double share = std::min(1.0, std::max(0.0, area / base_area));
    const double added = weight * share;
    placed[idx].load_on_top += added;
    if (applied) {
      applied->push_back({idx, added});
    }
  }

  return true;
}

void rollback_loads(std::vector<PlacedState>& placed, const std::vector<std::pair<size_t, double>>& applied) {
  for (const auto& [idx, added] : applied) {
    placed[idx].load_on_top -= added;
  }
}

Result pack_by_order(const Truck& truck, const std::vector<Box>& boxes, const std::vector<size_t>& order) {
  Result result;
  result.used_volume = 0;
  result.total_volume = 0;
  result.total_weight = 0;
  for (const auto& box : boxes) {
    result.total_volume += volume(box.w, box.h, box.d);
  }

  std::vector<PlacedState> placed;
  placed.reserve(order.size());

  std::vector<Candidate> candidates;
  candidates.reserve(order.size() * 3 + 8);
  candidates.push_back(Candidate{0, 0, 0});

  constexpr size_t kMaxCandidates = 350;

  auto add_candidate = [&](double x, double y, double z) {
    if (x < -kEps || y < -kEps || z < -kEps) return;
    candidates.push_back(Candidate{x, y, z});
  };

  auto unique_candidates = [&]() {
    auto key = [](const Candidate& c) {
      // quantize for de-dup
      const auto q = [](double v) { return static_cast<long long>(std::llround(v * 100000.0)); };
      return std::tuple<long long, long long, long long>(q(c.x), q(c.y), q(c.z));
    };
    std::sort(candidates.begin(), candidates.end(), [&](const Candidate& a, const Candidate& b) { return key(a) < key(b); });
    candidates.erase(std::unique(candidates.begin(), candidates.end(), [&](const Candidate& a, const Candidate& b) { return key(a) == key(b); }),
                     candidates.end());

    if (candidates.size() > kMaxCandidates) {
      std::stable_sort(candidates.begin(), candidates.end(), [](const Candidate& a, const Candidate& b) {
        if (a.y != b.y) return a.y < b.y;
        if (a.z != b.z) return a.z < b.z;
        return a.x < b.x;
      });
      candidates.resize(kMaxCandidates);
    }
  };

  double remaining_weight = truck.max_weight;

  auto collides_any = [&](const AABB& a) {
    for (const auto& p : placed) {
      if (intersects(a, p.box)) return true;
    }
    return false;
  };

  for (size_t idx : order) {
    const auto& box = boxes[idx];

    if (box.weight > remaining_weight + 1e-9) {
      result.unplaced.push_back(box.id);
      continue;
    }

    // 6 orientations
    const std::array<std::array<double, 3>, 6> rots = {
        std::array<double, 3>{box.w, box.h, box.d},
        std::array<double, 3>{box.w, box.d, box.h},
        std::array<double, 3>{box.h, box.w, box.d},
        std::array<double, 3>{box.h, box.d, box.w},
        std::array<double, 3>{box.d, box.w, box.h},
        std::array<double, 3>{box.d, box.h, box.w},
    };

    bool found = false;
    AABB best{};
    std::vector<std::pair<size_t, double>> best_loads;

    // Score: prefer lower Y (gravity), then lower Z, then lower X.
    auto better = [&](const AABB& a, const AABB& b) {
      if (a.y != b.y) return a.y < b.y;
      if (a.z != b.z) return a.z < b.z;
      return a.x < b.x;
    };

    unique_candidates();

    for (const auto& cand : candidates) {
      for (const auto& r : rots) {
        AABB candidate{cand.x, cand.y, cand.z, r[0], r[1], r[2]};

        if (!inside_truck(truck, candidate)) continue;
        if (collides_any(candidate)) continue;

        std::vector<std::pair<size_t, double>> applied;
        if (!support_ok_and_apply_load(candidate, box.weight, placed, &applied)) {
          rollback_loads(placed, applied);
          continue;
        }

        if (!found || better(candidate, best)) {
          if (found) {
            rollback_loads(placed, best_loads);
          }
          found = true;
          best = candidate;
          best_loads = std::move(applied);
        } else {
          rollback_loads(placed, applied);
        }
      }
    }

    if (!found) {
      result.unplaced.push_back(box.id);
      continue;
    }

    // best_loads already applied in placed states.
    placed.push_back(PlacedState{best, box.id, box.weight, max_load_for(box.weight, best.w * best.d), 0.0});

    result.placed.push_back(Placement{box.id, best.x, best.y, best.z, best.w, best.h, best.d});
    result.used_volume += volume(best.w, best.h, best.d);
    result.total_weight += box.weight;
    remaining_weight -= box.weight;

    // Add new candidate points around placed box (extreme points).
    add_candidate(best.x + best.w, best.y, best.z);
    add_candidate(best.x, best.y, best.z + best.d);
    add_candidate(best.x, best.y + best.h, best.z);
  }

  result.utilization = (truck.w * truck.h * truck.d) > 0 ? (result.used_volume / (truck.w * truck.h * truck.d)) : 0;
  return result;
}

struct Individual {
  std::vector<size_t> order;
  double score;
  Result result;
};

double score_result(const Result& r) {
  // Higher is better. Prefer utilization; penalize unplaced.
  return r.utilization * 100.0 - static_cast<double>(r.unplaced.size()) * 0.5;
}

}  // namespace

Result optimize_ga(const Truck& truck, const std::vector<Box>& boxes, int population, int generations, double mutation_rate, uint32_t seed) {
  if (boxes.empty()) {
    Result r;
    r.used_volume = 0;
    r.total_volume = 0;
    r.utilization = 0;
    r.total_weight = 0;
    return r;
  }

  std::mt19937 rng(seed);
  std::uniform_real_distribution<double> uni(0.0, 1.0);

  const size_t n = boxes.size();

  // Keep the engine responsive for interactive use.
  // For very large instances, cap GA workload aggressively.
  if (n > 250) {
    population = std::min(population, 10);
    generations = std::min(generations, 6);
  } else if (n > 150) {
    population = std::min(population, 18);
    generations = std::min(generations, 12);
  } else {
    population = std::min(population, 30);
    generations = std::min(generations, 25);
  }
  std::vector<size_t> base(n);
  for (size_t i = 0; i < n; ++i) base[i] = i;

  auto make_individual = [&](bool shuffle) {
    Individual ind;
    ind.order = base;
    if (shuffle) {
      std::shuffle(ind.order.begin(), ind.order.end(), rng);
    } else {
      // Seed with a reasonable heuristic: sort by volume desc then priority.
      std::stable_sort(ind.order.begin(), ind.order.end(), [&](size_t a, size_t b) {
        const auto& A = boxes[a];
        const auto& B = boxes[b];
        const double va = volume(A.w, A.h, A.d);
        const double vb = volume(B.w, B.h, B.d);
        if (std::fabs(va - vb) > 1e-12) return va > vb;
        return A.priority > B.priority;
      });
    }
    ind.result = pack_by_order(truck, boxes, ind.order);
    ind.score = score_result(ind.result);
    return ind;
  };

  population = std::max(population, 4);
  generations = std::max(generations, 1);

  std::vector<Individual> pop;
  pop.reserve(static_cast<size_t>(population));
  pop.push_back(make_individual(false));
  while (static_cast<int>(pop.size()) < population) {
    pop.push_back(make_individual(true));
  }

  auto select_parent = [&]() -> const Individual& {
    // Tournament selection (k=3)
    std::uniform_int_distribution<int> pick(0, population - 1);
    const Individual* best = nullptr;
    for (int i = 0; i < 3; ++i) {
      const Individual& cand = pop[static_cast<size_t>(pick(rng))];
      if (!best || cand.score > best->score) best = &cand;
    }
    return *best;
  };

  auto crossover = [&](const Individual& a, const Individual& b) {
    // Ordered crossover (OX)
    std::uniform_int_distribution<size_t> cut(0, n - 1);
    size_t i = cut(rng);
    size_t j = cut(rng);
    if (i > j) std::swap(i, j);

    std::vector<size_t> child(n, static_cast<size_t>(-1));
    std::unordered_set<size_t> used;
    used.reserve(n);

    for (size_t k = i; k <= j; ++k) {
      child[k] = a.order[k];
      used.insert(child[k]);
    }

    size_t write = 0;
    for (size_t k = 0; k < n; ++k) {
      const size_t gene = b.order[k];
      if (used.find(gene) != used.end()) continue;
      while (write < n && child[write] != static_cast<size_t>(-1)) ++write;
      if (write < n) child[write] = gene;
    }

    Individual ind;
    ind.order = std::move(child);
    return ind;
  };

  auto mutate = [&](Individual& ind) {
    if (uni(rng) > mutation_rate) return;
    std::uniform_int_distribution<size_t> pick(0, n - 1);
    const size_t a = pick(rng);
    const size_t b = pick(rng);
    std::swap(ind.order[a], ind.order[b]);
  };

  for (int gen = 0; gen < generations; ++gen) {
    std::sort(pop.begin(), pop.end(), [](const Individual& x, const Individual& y) { return x.score > y.score; });

    // Elitism: keep top 10%
    const int elite = std::max(1, population / 10);
    std::vector<Individual> next;
    next.reserve(static_cast<size_t>(population));
    for (int i = 0; i < elite; ++i) next.push_back(pop[static_cast<size_t>(i)]);

    while (static_cast<int>(next.size()) < population) {
      const Individual& p1 = select_parent();
      const Individual& p2 = select_parent();
      Individual child = crossover(p1, p2);
      mutate(child);
      child.result = pack_by_order(truck, boxes, child.order);
      child.score = score_result(child.result);
      next.push_back(std::move(child));
    }

    pop = std::move(next);
  }

  std::sort(pop.begin(), pop.end(), [](const Individual& x, const Individual& y) { return x.score > y.score; });
  return pop.front().result;
}

}  // namespace engine
