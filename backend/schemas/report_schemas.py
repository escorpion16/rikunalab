from pydantic import BaseModel, Field
from typing import Optional


class GenerateReportRequest(BaseModel):
    risk_score:         float  = Field(ge=0.0, le=100.0)
    risk_label:         str
    risk_color:         str
    recommendation:     str
    xai_method:         str
    filename:           str
    processing_time_ms: float
    module:             Optional[str] = Field(
                            default="glaucoma",
                            description="'glaucoma' o 'diabetic_retinopathy'"
                        )


class GenerateReportResponse(BaseModel):
    interpretation: str
    model_used:     str