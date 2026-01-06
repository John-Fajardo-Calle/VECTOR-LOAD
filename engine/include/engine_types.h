#pragma once

#include <string>
#include <vector>

namespace engine {

struct Box {
  std::string id;
  double w;
  double h;
  double d;
  double weight;
  int priority;
};

struct Truck {
  double w;
  double h;
  double d;
  double max_weight;
};

struct Placement {
  std::string id;
  double x;
  double y;
  double z;
  double w;
  double h;
  double d;
};

struct Result {
  std::vector<Placement> placed;
  std::vector<std::string> unplaced;
  double used_volume;
  double total_volume;
  double utilization;
  double total_weight;
};

}  // namespace engine
