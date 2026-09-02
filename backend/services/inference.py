"""
inference.py
------------
Servicio de inferencia para GlaucoScan AI.

Responsabilidades:
    - Cargar y mantener el modelo en memoria (singleton)
    - Orquestar el pipeline completo: preprocesado → XAI → respuesta
    - Calcular el nivel de riesgo clínico a partir del score
    - Medir el tiempo de procesamiento

Este módulo es el punto de entrada que usa main.py.
El modelo se carga una sola vez al iniciar el servidor
y se reutiliza en cada request — evita recargas costosas.
"""

import json
import time
from pathlib import Path
from typing import Literal

import numpy as np
import torch

from model.glaucoscan_model import GlaucoScanModel, load_model
from model.preprocessing import decode_image_bytes, preprocess_fundus_image
from services.xai_engine import XAIEngine


# ---------------------------------------------------------------------------
# CONSTANTES CLÍNICAS
# ---------------------------------------------------------------------------

# Umbrales de riesgo basados en el análisis del test set
# Ajustados para priorizar sensibilidad en screening clínico
_RISK_LEVELS = {
    "low": {
        "min":            0,
        "max":            40,
        "label":          "Sin señales de riesgo",
        "recommendation": "Revisión oftalmológica en 12 meses",
        "color":          "green"
    },
    "medium": {
        "min":            40,
        "max":            70,
        "label":          "Riesgo moderado",
        "recommendation": "Evaluación oftalmológica en 3 meses",
        "color":          "yellow"
    },
    "high": {
        "min":            70,
        "max":            100,
        "label":          "Alto riesgo",
        "recommendation": "Derivar a oftalmólogo especialista de forma prioritaria",
        "color":          "red"
    }
}

_DISCLAIMER = (
    "GlaucoScan AI es una herramienta de screening. "
    "No reemplaza el diagnóstico clínico por un oftalmólogo especialista."
)


# ---------------------------------------------------------------------------
# SERVICIO DE INFERENCIA (SINGLETON)
# ---------------------------------------------------------------------------

class InferenceService:
    """
    Servicio singleton que gestiona el modelo y el motor XAI.

    El patrón singleton garantiza que el modelo se carga
    una sola vez en memoria al iniciar el servidor FastAPI,
    independientemente del número de requests concurrentes.

    Usage:
        service = InferenceService(checkpoint_path, config_path)
        result  = service.analyze(image_bytes, xai_method)
    """

    def __init__(
        self,
        checkpoint_path: str,
        config_path: str
    ):
        """
        Inicializa el servicio cargando el modelo y la configuración.

        Args:
            checkpoint_path: ruta al archivo best_model.pth
            config_path    : ruta al archivo model_config.json

        Raises:
            FileNotFoundError: si alguno de los archivos no existe
        """
        # Determinar dispositivo disponible
        self.device = "cuda" if torch.cuda.is_available() else "cpu"

        # Cargar configuración del modelo
        self.config = self._load_config(config_path)

        # Cargar modelo entrenado
        self.model = load_model(
            checkpoint_path=checkpoint_path,
            model_name=self.config["model_name"],
            dropout=self.config["dropout"],
            device=self.device
        )

        # Inicializar motor XAI
        self.xai_engine = XAIEngine(
            model=self.model,
            device=self.device
        )

        self.model_version = self.config.get("version", "v1")
        self.img_size      = self.config.get("img_size", 224)

        print(
            f"[InferenceService] Modelo cargado correctamente\n"
            f"  Dispositivo   : {self.device.upper()}\n"
            f"  Versión       : {self.model_version}\n"
            f"  Tamaño imagen : {self.img_size}x{self.img_size}\n"
            f"  Test AUROC    : {self.config['metrics']['test_auroc']}"
        )

    # -----------------------------------------------------------------------
    # MÉTODOS PRIVADOS
    # -----------------------------------------------------------------------

    @staticmethod
    def _load_config(config_path: str) -> dict:
        """
        Carga la configuración del modelo desde JSON.

        Args:
            config_path: ruta al archivo model_config.json

        Returns:
            Diccionario con la configuración del modelo

        Raises:
            FileNotFoundError: si el archivo no existe
        """
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(
                f"Configuración no encontrada: {config_path}"
            )
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _calculate_risk_level(risk_score: float) -> dict:
        """
        Determina el nivel de riesgo clínico a partir del score.

        Args:
            risk_score: float en rango [0, 100]

        Returns:
            Diccionario con label, recommendation y color
        """
        if risk_score < _RISK_LEVELS["low"]["max"]:
            return _RISK_LEVELS["low"]
        elif risk_score < _RISK_LEVELS["medium"]["max"]:
            return _RISK_LEVELS["medium"]
        else:
            return _RISK_LEVELS["high"]

    # -----------------------------------------------------------------------
    # MÉTODO PRINCIPAL
    # -----------------------------------------------------------------------

    def analyze(
        self,
        image_bytes: bytes,
        xai_method: Literal["gradcam++", "eigengradcam"] = "gradcam++"
    ) -> dict:
        """
        Pipeline completo de análisis para una imagen fundus.

        Pasos:
            1. Decodificar bytes → array BGR
            2. Preprocesar (CLAHE + Ben Graham) → float32 [0,1]
            3. XAI engine → score + imágenes base64
            4. Calcular nivel de riesgo clínico
            5. Construir respuesta estructurada

        Args:
            image_bytes: contenido binario del archivo de imagen
            xai_method : método XAI a aplicar

        Returns:
            Diccionario con todos los campos de AnalyzeResponse

        Raises:
            ValueError: si la imagen no es válida
        """
        start_time = time.perf_counter()

        # 1. Decodificar imagen
        image_bgr = decode_image_bytes(image_bytes)

        # 2. Preprocesar
        image_float = preprocess_fundus_image(
            image_bgr=image_bgr,
            target_size=self.img_size
        )

        # 3. Análisis XAI (inferencia + mapa de calor)
        # Se pasa image_bgr (resolución original) para que el overlay
        # se genere a las dimensiones reales del fundus, preservando
        # el aspecto ratio natural de la imagen (no forzado a 224×224)
        xai_result = self.xai_engine.analyze(
            image_float_224=image_float,
            method=xai_method,
            original_image=image_bgr,
        )

        # 4. Nivel de riesgo clínico
        risk_level = self._calculate_risk_level(xai_result["risk_score"])

        # 5. Tiempo de procesamiento
        elapsed_ms = (time.perf_counter() - start_time) * 1000

        return {
            "risk_score": round(xai_result["risk_score"], 2),
            "risk_level": {
                "label":          risk_level["label"],
                "recommendation": risk_level["recommendation"],
                "color":          risk_level["color"]
            },
            "xai": {
                "method":              xai_result["method"],
                "original_image_b64":  xai_result["original_b64"],
                "heatmap_image_b64":   xai_result["heatmap_b64"],
                "overlay_image_b64":   xai_result["overlay_b64"]
            },
            "processing_time_ms": round(elapsed_ms, 2),
            "model_version":      self.model_version,
            "disclaimer":         _DISCLAIMER
        }