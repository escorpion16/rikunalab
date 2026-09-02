"""
main.py
-------
Servidor principal de GlaucoScan AI — FastAPI.

Endpoints:
    GET  /health    : verificación de estado del servidor y modelo
    POST /analyze   : análisis de imagen fundus con XAI

El modelo se carga una sola vez al iniciar el servidor
mediante el evento de startup de FastAPI (lifespan).

Configuración CORS: permite requests desde el frontend React
corriendo en localhost:5173 (puerto por defecto de Vite).
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from schemas.requests import AnalyzeResponse, HealthResponse
from services.inference import InferenceService

from dotenv import load_dotenv
from schemas.report_schemas import GenerateReportRequest, GenerateReportResponse
from services.report_service import generate_clinical_interpretation, OPENROUTER_MODEL

load_dotenv()   # ← carga el .env automáticamente

from services.dr_inference import DRInferenceService

# ---------------------------------------------------------------------------
# RUTAS DE ARCHIVOS DEL MODELO
# ---------------------------------------------------------------------------

# Ruta base del proyecto — sube dos niveles desde backend/
BASE_DIR        = Path(__file__).resolve().parent.parent
CHECKPOINT_PATH = BASE_DIR / "checkpoints" / "best_model.pth"
CONFIG_PATH     = BASE_DIR / "checkpoints" / "model_config.json"

DR_CHECKPOINT_PATH = BASE_DIR / "checkpoints" / "dr_model_best.pth"
DR_CONFIG_PATH     = BASE_DIR / "checkpoints" / "dr_model_config.json"

# ---------------------------------------------------------------------------
# SINGLETON DEL SERVICIO DE INFERENCIA
# ---------------------------------------------------------------------------

# Variable global que mantiene el servicio en memoria
# durante todo el ciclo de vida del servidor
inference_service: InferenceService | None = None

dr_inference_service: DRInferenceService | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global inference_service
    global dr_inference_service

    print("[GlaucoScan AI] Iniciando servidor...")
    print(f"  Checkpoint : {CHECKPOINT_PATH}")
    print(f"  Config     : {CONFIG_PATH}")

    # Módulo 1: Glaucoma
    inference_service = InferenceService(
        checkpoint_path=str(CHECKPOINT_PATH),
        config_path=str(CONFIG_PATH)
    )

    # Módulo 2: Retinopatía Diabética
    if DR_CHECKPOINT_PATH.exists() and DR_CONFIG_PATH.exists():
        dr_inference_service = DRInferenceService(
            checkpoint_path=str(DR_CHECKPOINT_PATH),
            config_path=str(DR_CONFIG_PATH)
        )
    else:
        print("[DR Module] Checkpoint no encontrado — módulo DR deshabilitado")
        print(f"  Esperado: {DR_CHECKPOINT_PATH}")

    print("[GlaucoScan AI] Servidor listo para recibir requests.\n")

    yield  # ← el servidor corre aquí

    # Shutdown — liberar recursos
    print("[GlaucoScan AI] Apagando servidor...")
    inference_service    = None
    dr_inference_service = None


# ---------------------------------------------------------------------------
# INSTANCIA DE LA APLICACIÓN
# ---------------------------------------------------------------------------

app = FastAPI(
    title="GlaucoScan AI",
    description=(
        "API de screening de glaucoma mediante análisis de imágenes "
        "fundus con Inteligencia Artificial explicable (XAI).\n\n"
        "**Disclaimer:** Herramienta de screening. "
        "No reemplaza el diagnóstico clínico especializado."
    ),
    version="1.0.0",
    lifespan=lifespan
)

# ---------------------------------------------------------------------------
# CORS — permite comunicación con el frontend React (Vite)
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite dev server
        "http://localhost:4173",   # Vite preview
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"]
)


# ---------------------------------------------------------------------------
# ENDPOINTS
# ---------------------------------------------------------------------------

@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Verificación de estado del servidor",
    tags=["Sistema"]
)
async def health_check() -> HealthResponse:
    """
    Verifica que el servidor está activo y el modelo cargado.

    Usado por el frontend para mostrar el estado de conexión
    con el backend antes de permitir análisis.
    """
    import torch

    is_loaded = inference_service is not None
    device    = "cuda" if torch.cuda.is_available() else "cpu"
    version   = (
        inference_service.model_version
        if is_loaded else "no_disponible"
    )

    return HealthResponse(
        status="ok" if is_loaded else "modelo_no_cargado",
        model_loaded=is_loaded,
        device=device.upper(),
        model_version=version
    )


@app.post(
    "/analyze",
    response_model=AnalyzeResponse,
    summary="Análisis de imagen fundus con XAI",
    tags=["Análisis"]
)
async def analyze_fundus(
    file: UploadFile = File(
        ...,
        description="Imagen fundus en formato JPEG o PNG"
    ),
    xai_method: str = Form(
        default="gradcam++",
        description="Método XAI: 'gradcam++' o 'eigengradcam'"
    )
) -> AnalyzeResponse:
    """
    Analiza una imagen fundus y devuelve:
    - Score de riesgo de glaucoma (0-100)
    - Nivel de riesgo con recomendación clínica
    - Imágenes XAI (original, mapa de calor, superposición) en base64
    - Tiempo de procesamiento

    El método XAI seleccionado determina cómo se genera
    el mapa de explicabilidad visual.
    """
    # Verificar que el servicio está disponible
    if inference_service is None:
        raise HTTPException(
            status_code=503,
            detail="El servicio de inferencia no está disponible. "
                   "Verifica que el servidor inició correctamente."
        )

    # Validar tipo de archivo
    allowed_types = {"image/jpeg", "image/jpg", "image/png"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=415,
            detail=f"Tipo de archivo no soportado: {file.content_type}. "
                   "Use JPEG o PNG."
        )

    # Validar método XAI
    allowed_methods = {"gradcam++", "eigengradcam"}
    xai_method = xai_method.lower().strip()
    if xai_method not in allowed_methods:
        raise HTTPException(
            status_code=400,
            detail=f"Método XAI no válido: '{xai_method}'. "
                   f"Use uno de: {allowed_methods}"
        )

    # Leer bytes de la imagen
    image_bytes = await file.read()

    if len(image_bytes) == 0:
        raise HTTPException(
            status_code=400,
            detail="El archivo recibido está vacío."
        )

    # Ejecutar pipeline de análisis
    try:
        result = inference_service.analyze(
            image_bytes=image_bytes,
            xai_method=xai_method
        )
    except ValueError as e:
        # Error de imagen inválida (no decodificable)
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        # Error inesperado — log interno, mensaje genérico al cliente
        print(f"[ERROR /analyze] {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=500,
            detail="Error interno durante el análisis. "
                   "Verifica que la imagen sea una fotografía fundus válida."
        )

    return AnalyzeResponse(**result)

@app.post(
    "/generate-report",
    response_model=GenerateReportResponse,
    summary="Genera interpretación clínica con LLM vía OpenRouter",
    tags=["Análisis"]
)
async def generate_report(body: GenerateReportRequest) -> GenerateReportResponse:
    try:
        interpretation = await generate_clinical_interpretation(
            risk_score=body.risk_score,
            risk_label=body.risk_label,
            risk_color=body.risk_color,
            recommendation=body.recommendation,
            xai_method=body.xai_method,
            filename=body.filename,
            processing_time_ms=body.processing_time_ms,
            module=body.module or "glaucoma", 
        )
    except Exception as e:
        print(f"[ERROR /generate-report] {type(e).__name__}: {e}")
        raise HTTPException(
            status_code=503,
            detail=f"Error al generar interpretación: {str(e)}"
        )

    return GenerateReportResponse(
        interpretation=interpretation or "Interpretación no disponible.",
        model_used=OPENROUTER_MODEL,
    )

@app.post(
    "/analyze/dr",
    response_model=AnalyzeResponse,
    summary="Análisis de Retinopatía Diabética con XAI",
    tags=["Análisis"]
)
async def analyze_dr(
    file: UploadFile = File(...),
    xai_method: str = Form(default="eigengradcam")
) -> AnalyzeResponse:
    if dr_inference_service is None:
        raise HTTPException(status_code=503,
            detail="Módulo DR no disponible.")
    allowed_types = {"image/jpeg", "image/jpg", "image/png"}
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=415,
            detail=f"Tipo no soportado: {file.content_type}")
    xai_method = xai_method.lower().strip()
    if xai_method not in {"gradcam++", "eigengradcam"}:
        raise HTTPException(status_code=400,
            detail=f"Método XAI no válido: '{xai_method}'")
    image_bytes = await file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Archivo vacío.")
    try:
        result = dr_inference_service.analyze(
            image_bytes=image_bytes,
            xai_method=xai_method
        )
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        print(f"[ERROR /analyze/dr] {type(e).__name__}: {e}")
        raise HTTPException(status_code=500,
            detail="Error interno en análisis DR.")
    return AnalyzeResponse(**result)

@app.get(
    "/health/dr",
    summary="Estado del módulo de Retinopatía Diabética",
    tags=["Sistema"]
)
async def health_dr():
    """Verifica que el módulo DR está cargado y operativo."""
    import torch
    is_loaded = dr_inference_service is not None
    return {
        "status":        "ok" if is_loaded else "no_disponible",
        "module":        "diabetic_retinopathy",
        "model_loaded":  is_loaded,
        "device":        "CUDA" if torch.cuda.is_available() else "CPU",
        "model_version": dr_inference_service.model_version if is_loaded else None,
        "threshold":     dr_inference_service.threshold     if is_loaded else None,
    }