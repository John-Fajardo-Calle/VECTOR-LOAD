# Logistics Optimizer Suite (3D Digital Twin)

[![CI](https://github.com/John-Fajardo-Calle/VECTOR-LOAD/actions/workflows/ci.yml/badge.svg)](https://github.com/John-Fajardo-Calle/VECTOR-LOAD/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Truck-loading optimization with a **3D digital twin**.

Generate a dataset of SKUs (boxes), optimize their placement inside a truck while enforcing lightweight “physics” constraints (support + crushing), and visualize the result step-by-step.

---

## Tech Stack

- **Frontend**: React + Vite + Three.js
- **Backend**: Python 3.12 + Flask (served with Gunicorn in containers)
- **Engine**: C++17 + pybind11 native module exposed via Flask
- **Infra**: Docker Compose (dev + production-like)

---

## Prerequisites

Recommended:

- Docker Desktop + Docker Compose

Optional (for local development without Docker):

- Python 3.12+
- Node.js 18+
- C++ toolchain + CMake/Ninja (only if compiling the engine outside Docker)

---

## Installation

### 1) Clone

```bash
git clone https://github.com/John-Fajardo-Calle/VECTOR-LOAD.git
cd VECTOR-LOAD
```

### 2) Environment files

This repo uses environment variables for service wiring. Copy the examples and adjust as needed.

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env
```

---

## Usage

### Development (Docker Compose)

This mode is developer-friendly (bind mounts, Vite dev server).

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f
```

URLs:

- Frontend: http://localhost:3000
- Backend health: http://localhost:5000/health
- Engine health: http://localhost:6000/health

Stop:

```bash
docker compose down
```

### Production-like (Docker Compose)

This mode builds immutable images: frontend is served by Nginx, backend runs under Gunicorn, no source mounts.

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Ports:

- Frontend: http://localhost:3000
- Backend: http://localhost:5000

---

## API Examples

Backend base URL: `http://localhost:5000`

### Generate a dataset

```bash
curl -X POST http://localhost:5000/api/simulate \
  -H "Content-Type: application/json" \
  -d '{"num_skus": 500, "seed": 123, "truck": {"w": 2.4, "h": 2.6, "d": 12.0, "max_weight": 12000}}'
```

### Optimize (dataset-backed)

```bash
curl -X POST http://localhost:5000/api/optimize \
  -H "Content-Type: application/json" \
  -d '{"dataset_id": "dataset_...", "params": {"population": 20, "generations": 15, "mutation_rate": 0.08, "seed": 123}}'
```

### Reset datasets

```bash
curl -X POST http://localhost:5000/api/reset -H "Content-Type: application/json" -d '{}'
```

Engine base URL: `http://localhost:6000`

```bash
curl -X POST http://localhost:6000/optimize \
  -H "Content-Type: application/json" \
  -d '{"truck": {"w": 2.4, "h": 2.6, "d": 6.0, "max_weight": 1000}, "boxes": [], "params": {}}'
```

---

## Tests

Run from Docker (recommended):

```bash
docker compose exec -T backend pytest -q
```

UI test button uses `POST /api/tests/run`.

Note: for production deployments, the test endpoint is disabled by default via `ENABLE_TEST_ENDPOINT=0`.

---

## Configuration

Backend environment variables (common):

- `ENGINE_URL` (default: `http://engine:6000`)
- `DATA_DIR` (default: `/app/data`)
- `ENGINE_TIMEOUT_S` (default: `300`)
- `ENABLE_TEST_ENDPOINT` (default: `0` in prod-like compose)
- `CORS_ORIGINS` (optional, comma-separated; recommended in prod)

Frontend environment variables:

- `VITE_BACKEND_URL` (default: `http://localhost:5000`)

---

## Features / Roadmap

Current:

- 3D digital twin viewer (hover + click inspect)
- Step-by-step animation playback of a packing plan
- Dataset generation with replace/reset flows
- Optimization via native engine (support + crushing constraints)
- Health checks and production-like containers
- CI workflow (GitHub Actions + Docker Compose)

Planned:

- Auth for administrative endpoints (e.g., test runner)
- Persisted runs and downloadable reports

---

## Contributing

Pull requests are welcome.

1. Fork the repo
2. Create a feature branch
3. Run tests (`pytest -q`)
4. Open a PR with a clear description

---

## License & Contact

- License: MIT (see `LICENSE`)
- Author: John Fajardo Calle — john.fajardo.calle@gmail.com — https://github.com/John-Fajardo-Calle

---

# Logistics Optimizer Suite (Gemelo Digital 3D)

Optimización de carga de camiones con **gemelo digital 3D**.

Genera un dataset de SKUs (cajas), optimiza su colocación dentro del camión con restricciones simples de “física” (soporte + aplastamiento) y visualiza el resultado paso a paso.

## Stack

- **Frontend**: React + Vite + Three.js
- **Backend**: Python 3.12 + Flask (Gunicorn en contenedores)
- **Engine**: C++17 + pybind11 expuesto vía Flask
- **Infra**: Docker Compose (dev + modo producción)

## Instalación (rápida)

```bash
git clone https://github.com/John-Fajardo-Calle/VECTOR-LOAD.git
cd VECTOR-LOAD
cp .env.example .env
cp frontend/.env.example frontend/.env
```

## Uso

Dev:

```bash
docker compose up -d --build
```

Producción (modo “prod-like”):

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

## Tests

```bash
docker compose exec -T backend pytest -q
```

### `GET /health`
Respuesta:
```json
{ "status": "ok" }
```

### `POST /optimize`
Cuerpo:
```json
{
  "truck": { "w": 2.4, "h": 2.6, "d": 12.0, "max_weight": 12000 },
  "boxes": [
    { "id": "SKU-00001", "w": 0.5, "h": 0.4, "d": 0.6, "weight": 5.0, "priority": 2 }
  ],
  "params": { "population": 20, "generations": 15, "mutation_rate": 0.08, "seed": 123 }
}
```

---

## “Físicas” implementadas (modelo simple)

El engine aplica reglas para evitar soluciones irreales:

- **Soporte mínimo**: una caja sobre otra exige un porcentaje alto de área de base soportada.
- **Centro soportado**: el centro (x,z) de la caja debe caer sobre alguna caja soporte.
- **Aplastamiento (crush)**: cada caja tiene capacidad limitada; se rechazan apilamientos que exceden esa capacidad.

> Nota: es un modelo simplificado (heurístico), diseñado para mejorar realismo sin simular dinámica completa.

- **Minimum support**: a box stacked on another requires a high supported base-area ratio.
- **Supported centroid**: the box centroid (x,z) must land on at least one supporting box.
- **Crushing (crush)**: each box has limited capacity; stacks exceeding it are rejected.

> Note: this is a simplified (heuristic) model aimed at better realism without simulating full dynamics.

---

## Configuración (variables de entorno)

### Backend
- `ENGINE_URL` (default `http://engine:6000` en Docker)
- `DATA_DIR` (default `/app/data` en Docker)
- `HOST` (default `0.0.0.0`)
- `PORT` (default `5000`)

### Engine
- `HOST` (default `0.0.0.0`)
- `PORT` (default `6000`)

### Frontend
- `VITE_BACKEND_URL` (default `http://localhost:5000`)

---

## Estructura del repositorio

- `backend/` API Flask y simulador de SKUs
- `engine/` motor C++ + bindings pybind11 + microservicio Flask
- `frontend/` React/Vite/Three.js
- `tests/` tests de integración (pytest)
- `data/` datasets generados (`dataset_*.json`)

---

## Solución de problemas

### “Optimizar” no hace nada o tarda mucho
- Revisa logs:
  ```powershell
  docker compose logs -f backend
  docker compose logs -f engine
  ```
- Reduce `num_skus` (por ejemplo 100–300).
- Reduce `population`/`generations`.

### Errores de conexión
- Verifica health:
  - http://localhost:5000/health
  - http://localhost:6000/health

---

## Estado del proyecto

Proyecto funcional con:
- Generación de datasets
- Optimización (con restricciones básicas de soporte/aplastamiento)
- Visualización 3D
- Tests ejecutables por UI o por `pytest`

---

## Licencia

Licencia MIT (ver `LICENSE`).
