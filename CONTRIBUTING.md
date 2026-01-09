# Contributing

Thanks for your interest in contributing to **VECTOR-LOAD**.

## Quick start

1. Fork the repository
2. Create a feature branch

```bash
git checkout -b feature/my-change
```

3. Make your changes
4. Run checks locally

```bash
# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-dev.txt
pytest -q

# Frontend
cd frontend
npm install
npm run build
```

5. Commit with a clear message and open a Pull Request

## What makes a good PR

- Clear problem statement and expected behavior
- Small, focused diff when possible
- Tests for new logic (or a short explanation why not)
- Screenshots for UI changes

## Code style

- Prefer readable naming over cleverness
- Keep simulation logic deterministic under seeding
- Avoid introducing heavyweight dependencies unless they are clearly justified