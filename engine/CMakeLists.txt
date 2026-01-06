cmake_minimum_required(VERSION 3.12)
project(OptimizationEngine)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Pybind11
find_package(pybind11 CONFIG REQUIRED)

# Engine library
file(GLOB ENGINE_SOURCES "src/*.cpp")
file(GLOB ENGINE_HEADERS "include/*.h")

add_library(engine ${ENGINE_SOURCES})
target_include_directories(engine PUBLIC include)

# Python bindings
pybind11_add_module(engine_bindings bindings/engine_bindings.cpp)
target_link_libraries(engine_bindings PRIVATE engine)
target_include_directories(engine_bindings PRIVATE include)
