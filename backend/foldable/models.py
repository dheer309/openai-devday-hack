from typing import Annotated, Literal, Union
import re

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class FaceStyle(StrictModel):
    eyes: Literal["round", "sleepy", "happy"] = "round"
    mouth: Literal["smile", "neutral", "open"] = "smile"
    whiskers: bool = False
    markings: Literal["none", "freckles", "forehead_patch"] = "none"


class NamedDesign(StrictModel):
    name: str = Field(min_length=1, max_length=48)
    face: FaceStyle = Field(default_factory=FaceStyle)

    @field_validator("name")
    @classmethod
    def plain_name(cls, value):
        value = value.strip()
        if not value or re.search(r"[\x00-\x1f\x7f]", value):
            raise ValueError("Use a nonempty plain display name.")
        # Built-in PDF fonts support Western European display names.
        try:
            value.encode("cp1252")
        except UnicodeEncodeError:
            raise ValueError("Use a Latin-script name for this printable version.")
        return value


class DesignV1(NamedDesign):
    version: Literal[1] = 1
    shape: Literal["box"] = "box"
    edge_mm: Literal[40] = 40


class Proportions(StrictModel):
    width: float = Field(default=1, ge=0.75, le=1.3)
    height: float = Field(default=1, ge=0.75, le=1.3)
    depth: float = Field(default=1, ge=0.75, le=1.3)


class DesignV2(NamedDesign):
    version: Literal[2] = 2
    shape: Literal["box", "rounded", "diamond", "crystal"] = "rounded"
    proportions: Proportions = Field(default_factory=Proportions)
    ears: Literal["none", "pointed"] = "none"
    size_mm: float = Field(default=50, ge=40, le=65)


Design = Annotated[Union[DesignV1, DesignV2], Field(discriminator="version")]
DESIGN_ADAPTER = TypeAdapter(Design)


class PrintError(Exception):
    def __init__(self, message: str, details: list[str] | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or []


REQUIRED_CHECKS = [
    "closed_mesh", "seam_lengths", "seam_labels", "one_tab_per_seam",
    "no_overlaps", "page_bounds", "label_legibility", "refold_geometry",
]
