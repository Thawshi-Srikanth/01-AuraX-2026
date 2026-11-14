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


# Display retains finite, potentially affected measurements as visual context.
# These flags describe unusable detector/data samples, not artifact warnings.
DISPLAY_UNUSABLE_FLAGS = (1 << 6) | (1 << 7) | (1 << 9)


def displayable_pixels(image, flags):
    return np.isfinite(image) & (
        (np.asarray(flags).astype(np.uint64) & DISPLAY_UNUSABLE_FLAGS) == 0
    )
