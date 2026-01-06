from __future__ import annotations

from dataclasses import dataclass
from random import Random
from typing import Any


@dataclass(frozen=True)
class SKU:
    """Synthetic SKU used for simulation-driven demos."""

    sku: str
    w: float
    h: float
    d: float
    weight: float
    priority: int


def generate_truck(truck_payload: Any | None) -> dict[str, float]:
    """Normalize a truck payload into the engine-facing shape.

    Accepts partial input and fills defaults to keep the UI forgiving.
    """
    if isinstance(truck_payload, dict):
        return {
            "w": float(truck_payload.get("w", 2.4)),
            "h": float(truck_payload.get("h", 2.6)),
            "d": float(truck_payload.get("d", 12.0)),
            "max_weight": float(truck_payload.get("max_weight", 12_000.0)),
        }
    return {"w": 2.4, "h": 2.6, "d": 12.0, "max_weight": 12_000.0}


def generate_skus(num_skus: int, seed: int | None) -> list[SKU]:
    """Generate a reproducible list of random SKUs.

    Args:
        num_skus: number of items to generate
        seed: RNG seed for repeatable results

    Returns:
        List of SKU objects with dimensions in meters and weight in kg.
    """
    rng = Random(seed)
    skus: list[SKU] = []

    for i in range(num_skus):
        # Dimensions in meters; weights in kg.
        w = rng.uniform(0.1, 0.8)
        h = rng.uniform(0.05, 0.6)
        d = rng.uniform(0.1, 1.2)
        weight = rng.uniform(0.2, 40.0)
        priority = rng.randint(1, 5)
        skus.append(SKU(sku=f"SKU-{i:05d}", w=w, h=h, d=d, weight=weight, priority=priority))

    return skus
