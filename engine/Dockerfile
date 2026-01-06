# Engine (C++/CMake + pybind11) container
FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        ninja-build \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY CMakeLists.txt /app/engine/CMakeLists.txt
COPY include /app/engine/include
COPY src /app/engine/src
COPY bindings /app/engine/bindings
COPY service /app/engine/service

RUN python -m pip install --upgrade pip setuptools wheel \
    && pip install --no-cache-dir pybind11 \
    && pip install --no-cache-dir -r /app/engine/service/requirements.txt

RUN PYBIND11_DIR="$(python -c 'import pybind11; print(pybind11.get_cmake_dir())')" \
        && cmake -S /app/engine -B /app/engine/build -G Ninja \
            -DCMAKE_BUILD_TYPE=Release \
            -Dpybind11_DIR="$PYBIND11_DIR" \
        && cmake --build /app/engine/build

ENV PYTHONPATH=/app/engine/build
EXPOSE 6000
CMD ["python", "-u", "/app/engine/service/main.py"]
