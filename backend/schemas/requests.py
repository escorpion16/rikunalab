"""
requests.py
-----------
Esquemas Pydantic para validación de requests y responses de la API.

Pydantic valida automáticamente los tipos y genera documentación
en /docs (Swagger UI) sin configuración adicional.
"""

from pydantic import BaseModel, Field
from typing import Literal


# ---------------------------------------------------------------------------
# REQUEST SCHEMAS
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    """
    Parámetros de la solicitud de análisis.
    La imagen se recibe como UploadFile en el endpoint,
    no como campo de este schema.
    """
    xai_method: Literal["gradcam++", "eigengradcam"] = Field(
        default="gradcam++",
        description="Método XAI para generar el mapa de explicabilidad"
    )


# ---------------------------------------------------------------------------
# RESPONSE SCHEMAS
# ---------------------------------------------------------------------------

class RiskLevel(BaseModel):
    """Información del nivel de riesgo calculado."""
    label: str = Field(
        description="Etiqueta clínica del nivel de riesgo"
    )
    recommendation: str = Field(
        description="Recomendación clínica para el médico"
    )
    color: str = Field(
        description="Color semántico: green | yellow | red"
    )


class XAIResult(BaseModel):
    """Resultados de la explicabilidad visual."""
    method: str = Field(
        description="Método XAI aplicado"
    )
    original_image_b64: str = Field(
        description="Imagen original preprocesada en base64 (PNG)"
    )
    heatmap_image_b64: str = Field(
        description="Mapa de calor puro en base64 (PNG)"
    )
    overlay_image_b64: str = Field(
        description="Superposición de imagen y mapa de calor en base64 (PNG)"
    )


class AnalyzeResponse(BaseModel):
    """
    Respuesta completa del endpoint /analyze.

    Contiene el score de riesgo, nivel de riesgo,
    imágenes XAI en base64 y metadatos del análisis.
    """
    risk_score: float = Field(
        ge=0.0, le=100.0,
        description="Score de riesgo de glaucoma en rango [0, 100]"
    )
    risk_level: RiskLevel = Field(
        description="Nivel de riesgo con etiqueta y recomendación"
    )
    xai: XAIResult = Field(
        description="Resultados de explicabilidad visual"
    )
    processing_time_ms: float = Field(
        description="Tiempo de procesamiento en milisegundos"
    )
    model_version: str = Field(
        description="Versión del modelo usado"
    )
    disclaimer: str = Field(
        default=(
            "GlaucoScan AI es una herramienta de screening. "
            "No reemplaza el diagnóstico clínico por un "
            "oftalmólogo especialista."
        ),
        description="Aviso legal obligatorio en herramientas de screening"
    )


class HealthResponse(BaseModel):
    """Respuesta del endpoint de health check."""
    status: str
    model_loaded: bool
    device: str
    model_version: str

class DRAnalyzeResponse(BaseModel):
        risk_score: float = Field(ge=0.0, le=100.0)
        risk_level: RiskLevel           # reutiliza el schema existente
        prediction: Literal["RD", "NRD"]
        xai: XAIResult                  # reutiliza el schema existente
        processing_time_ms: float
        model_version: str
        module: str = "diabetic_retinopathy"
        disclaimer: str