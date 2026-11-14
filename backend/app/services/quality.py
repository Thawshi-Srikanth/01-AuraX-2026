"""Conservative shared image-pixel quality policy, not photometry certification."""

import numpy as np

INFORMATIONAL_FLAGS = (1 << 21) | (1 << 12)


def usable_pixels(image, variance, flags):
    excluded_bits = np.uint64(0xFFFFFFFFFFFFFFFF ^ INFORMATIONAL_FLAGS)
    flag_values = np.asarray(flags).astype(np.uint64)
    return (
        np.isfinite(image)
        & np.isfinite(variance)
        & (variance >= 0)
        & ((flag_values & excluded_bits) == 0)
    )
