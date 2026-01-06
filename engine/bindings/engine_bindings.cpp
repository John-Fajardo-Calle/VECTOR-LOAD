#include <pybind11/pybind11.h>
#include <pybind11/stl.h>

#include "engine_types.h"

namespace py = pybind11;

namespace engine {
Result optimize_ga(const Truck& truck, const std::vector<Box>& boxes, int population, int generations, double mutation_rate, uint32_t seed);
}

static engine::Truck truck_from_dict(const py::dict& d) {
  engine::Truck t;
  t.w = py::float_(d["w"]);
  t.h = py::float_(d["h"]);
  t.d = py::float_(d["d"]);
  if (d.contains("max_weight")) {
    t.max_weight = py::float_(d["max_weight"]).cast<double>();
  } else {
    t.max_weight = 12000.0;
  }
  return t;
}

static engine::Box box_from_any(const py::handle& obj) {
  auto d = py::reinterpret_borrow<py::dict>(obj);
  engine::Box b;
  b.id = py::str(d.contains("id") ? d["id"] : d["sku"]);
  b.w = py::float_(d["w"]);
  b.h = py::float_(d["h"]);
  b.d = py::float_(d["d"]);
  if (d.contains("weight")) {
    b.weight = py::float_(d["weight"]).cast<double>();
  } else {
    b.weight = 1.0;
  }
  if (d.contains("priority")) {
    b.priority = py::int_(d["priority"]).cast<int>();
  } else {
    b.priority = 1;
  }
  return b;
}

PYBIND11_MODULE(engine_bindings, m) {
  m.doc() = "High-performance logistics optimization engine";

  m.def(
      "optimize",
      [](py::dict truck, py::list boxes, py::dict params) {
        const auto t = truck_from_dict(truck);

        std::vector<engine::Box> b;
        b.reserve(static_cast<size_t>(py::len(boxes)));
        for (auto item : boxes) b.push_back(box_from_any(item));

        const int population = params.contains("population") ? py::int_(params["population"]).cast<int>() : 40;
        const int generations = params.contains("generations") ? py::int_(params["generations"]).cast<int>() : 40;
        const double mutation_rate = params.contains("mutation_rate") ? py::float_(params["mutation_rate"]).cast<double>() : 0.08;
        const uint32_t seed = params.contains("seed") ? py::int_(params["seed"]).cast<uint32_t>() : 12345u;

        const auto r = engine::optimize_ga(t, b, population, generations, mutation_rate, seed);

        py::list placed;
        for (const auto& p : r.placed) {
          py::dict item;
          item["id"] = p.id;
          item["x"] = p.x;
          item["y"] = p.y;
          item["z"] = p.z;
          item["w"] = p.w;
          item["h"] = p.h;
          item["d"] = p.d;
          placed.append(item);
        }

        py::dict out;
        out["placed"] = placed;
        out["unplaced"] = r.unplaced;
        py::dict metrics;
        metrics["used_volume"] = r.used_volume;
        metrics["total_volume"] = r.total_volume;
        metrics["utilization"] = r.utilization;
        metrics["total_weight"] = r.total_weight;
        out["metrics"] = metrics;
        return out;
      },
      py::arg("truck"), py::arg("boxes"), py::arg("params") = py::dict());
}
