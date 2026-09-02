"""
services/dr_inference.py
------------------------
Servicio de inferencia para el Módulo 2: Retinopatía Diabética.

El modelo fue entrenado con timm.create_model directamente en el notebook,
por lo que se carga con la misma estructura para compatibilidad total.
"""

import json
import time
import base64
import io
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
import torch
import torch.nn as nn
import timm
from PIL import Image
from pytorch_grad_cam import EigenCAM, GradCAMPlusPlus
from pytorch_grad_cam.utils.image import show_cam_on_image


# ---------------------------------------------------------------------------
# UTILIDADES DE IMAGEN (independientes de XAIEngine de glaucoma)
# ---------------------------------------------------------------------------

def _to_base64(img_np: np.ndarray) -> str:
    pil = Image.fromarray(img_np.astype(np.uint8))
    buf = io.BytesIO()
    pil.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _build_tissue_mask(image_float: np.ndarray) -> np.ndarray:
    """Máscara suave del tejido retiniano — suprime fondo negro/gris."""
    img_u8 = (image_float * 255).astype(np.uint8)
    hsv = cv2.cvtColor(img_u8, cv2.COLOR_RGB2HSV)
    _, m1 = cv2.threshold(hsv[:, :, 1], 20, 255, cv2.THRESH_BINARY)
    _, m2 = cv2.threshold(img_u8.max(axis=2), 10, 255, cv2.THRESH_BINARY)
    combined = cv2.bitwise_or(m1, m2)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (21, 21))
    filled = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, k)
    filled = cv2.morphologyEx(filled, cv2.MORPH_CLOSE, k)
    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    h, w = image_float.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    if contours:
        largest = max(contours, key=cv2.contourArea)
        cv2.drawContours(mask, [largest], -1, 255, thickness=cv2.FILLED)
    soft = cv2.GaussianBlur(mask.astype(np.float32), (61, 61), sigmaX=20)
    return np.clip(soft / max(soft.max(), 1e-6), 0.0, 1.0)


# ---------------------------------------------------------------------------
# WRAPPER para pytorch-grad-cam
# ---------------------------------------------------------------------------

class _Wrapper(nn.Module):
    def __init__(self, model: nn.Module):
        super().__init__()
        self.model = model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.model(x)


# ---------------------------------------------------------------------------
# SERVICIO DR
# ---------------------------------------------------------------------------

class DRInferenceService:
    """
    Servicio singleton para inferencia de Retinopatía Diabética.
    Carga EfficientNet-B3 entrenado con timm directamente (sin wrapper backbone).
    """

    _MEAN = torch.tensor([0.485, 0.456, 0.406])
    _STD  = torch.tensor([0.229, 0.224, 0.225])

    def __init__(self, checkpoint_path: str, config_path: str, device: str = "cuda"):
        self.device = torch.device(device if torch.cuda.is_available() else "cpu")
        self._load_config(config_path)
        self._load_model(checkpoint_path)

        print("[DRInferenceService] Módulo Retinopatía Diabética cargado")
        print(f"  Dispositivo : {str(self.device).upper()}")
        print(f"  Versión     : {self.model_version}")
        print(f"  Umbral      : {self.threshold:.4f}")
        print(f"  AUROC test  : {self.config['metrics']['auroc']}")

    def _load_config(self, config_path: str) -> None:
        with open(config_path, "r", encoding="utf-8") as f:
            self.config = json.load(f)
        self.model_version = self.config.get("version", "v1")
        self.img_size      = self.config.get("img_size", 224)
        self.threshold     = float(self.config.get("threshold", 0.5))

    def _load_model(self, checkpoint_path: str) -> None:
        """
        Carga el checkpoint generado por el notebook de entrenamiento.
        El notebook usó timm.create_model directamente y guardó model.state_dict()
        dentro de {'epoch': ..., 'model_state': ..., 'val_auroc': ...}
        """
        ckpt = torch.load(checkpoint_path, map_location=self.device)

        # Extraer state_dict del checkpoint
        if isinstance(ckpt, dict) and "model_state" in ckpt:
            state_dict = ckpt["model_state"]
        else:
            state_dict = ckpt  # fallback: el ckpt es el state_dict directamente

        # Crear modelo timm con la misma arquitectura del notebook
        self.model = timm.create_model(
            "efficientnet_b3",
            pretrained=False,
            num_classes=1
        ).to(self.device)

        self.model.load_state_dict(state_dict)
        self.model.eval()

        # Wrapper para pytorch-grad-cam
        self._wrapper = _Wrapper(self.model)

        # Capa objetivo para CAM: último bloque de EfficientNet-B3 en timm
        # En timm, la estructura es model.blocks[-1] (no model.backbone.blocks[-1])
        self._target_layer = self.model.blocks[-1]

    # ── Preprocesamiento ──────────────────────────────────────────────────────

    def _decode(self, image_bytes: bytes) -> np.ndarray:
        arr = np.frombuffer(image_bytes, dtype=np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("No se pudo decodificar la imagen.")
        return img

    def _preprocess(self, img_bgr: np.ndarray) -> np.ndarray:
        """Ben Graham preprocessing → float32 [0,1] RGB."""
        img = cv2.resize(img_bgr, (self.img_size, self.img_size))
        img = cv2.addWeighted(img, 4, cv2.GaussianBlur(img, (0, 0), 10), -4, 128)
        h, w = img.shape[:2]
        mask = np.zeros((h, w), dtype=np.uint8)
        cv2.circle(mask, (w // 2, h // 2), int(min(h, w) * 0.475), 1, -1)
        img = img * mask[:, :, np.newaxis]
        img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return img.astype(np.float32) / 255.0

    def _to_tensor(self, img_float: np.ndarray) -> torch.Tensor:
        t = torch.from_numpy(img_float.transpose(2, 0, 1))
        t = (t - self._MEAN.view(3, 1, 1)) / self._STD.view(3, 1, 1)
        return t.unsqueeze(0).to(self.device)

    # ── XAI ──────────────────────────────────────────────────────────────────

    def _generate_cam(
        self,
        img_tensor: torch.Tensor,
        img_float: np.ndarray,
        method: str
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Genera overlay, heatmap puro e imagen original en uint8."""

        target_layers = [self._target_layer]

        if method == "gradcam++":
            cam_obj = GradCAMPlusPlus(model=self._wrapper, target_layers=target_layers)
        else:
            cam_obj = EigenCAM(model=self._wrapper, target_layers=target_layers)

        grayscale_cam = cam_obj(input_tensor=img_tensor, targets=None)[0]

        # Aplicar máscara de tejido
        tissue = _build_tissue_mask(img_float)
        grayscale_cam = grayscale_cam * tissue
        mx = grayscale_cam.max()
        if mx > 1e-6:
            grayscale_cam = grayscale_cam / mx

        # Overlay
        overlay = show_cam_on_image(
            img_float, grayscale_cam,
            use_rgb=True, colormap=cv2.COLORMAP_JET, image_weight=0.55
        )
        orig_u8    = (img_float * 255).clip(0, 255).astype(np.uint8)
        tissue_3ch = np.stack([tissue, tissue, tissue], axis=2)
        overlay    = (
            overlay.astype(np.float32) * tissue_3ch +
            orig_u8.astype(np.float32) * (1.0 - tissue_3ch)
        ).astype(np.uint8)

        # Heatmap puro
        heatmap = cv2.applyColorMap(
            (grayscale_cam * 255).astype(np.uint8), cv2.COLORMAP_JET
        )
        heatmap = cv2.cvtColor(heatmap, cv2.COLOR_BGR2RGB)
        hard    = (tissue > 0.5).astype(np.uint8)
        heatmap = heatmap * np.stack([hard, hard, hard], axis=2)

        return overlay, heatmap, orig_u8

    # ── Nivel de riesgo ───────────────────────────────────────────────────────

    def _risk_level(self, score: float) -> dict:
        if score < 30.0:
            return {
                "label": "Sin señales de retinopatía referible",
                "color": "green",
                "recommendation": (
                    "No se identificaron signos de retinopatía diabética referible. "
                    "Control oftalmológico en 12 meses y mantener HbA1c < 7%."
                )
            }
        elif score < 65.0:
            return {
                "label": "Riesgo Moderado — Posibles signos de DR",
                "color": "yellow",
                "recommendation": (
                    "Posibles signos de retinopatía diabética leve-moderada. "
                    "Optimizar control glucémico y derivar a oftalmología en 3-6 meses."
                )
            }
        else:
            return {
                "label": "Alto Riesgo — Retinopatía Referible",
                "color": "red",
                "recommendation": (
                    "Signos compatibles con retinopatía diabética referible. "
                    "Derivar a oftalmólogo de forma prioritaria en las próximas 2-4 semanas."
                )
            }

    # ── Análisis principal ────────────────────────────────────────────────────

    def analyze(
        self,
        image_bytes: bytes,
        xai_method: Literal["gradcam++", "eigengradcam"] = "eigengradcam"
    ) -> dict:
        t0 = time.time()

        img_bgr   = self._decode(image_bytes)
        img_float = self._preprocess(img_bgr)
        img_tensor = self._to_tensor(img_float)

        # Inferencia
        with torch.no_grad():
            with torch.autocast(device_type="cuda", dtype=torch.float16):
                logit = self.model(img_tensor)
            risk_score = float(torch.sigmoid(logit).cpu()) * 100

        # XAI
        overlay, heatmap, orig_u8 = self._generate_cam(img_tensor, img_float, xai_method)

        risk_level   = self._risk_level(risk_score)
        is_referible = risk_score >= (self.threshold * 100)

        return {
            "risk_score": risk_score,
            "risk_level": risk_level,
            "prediction": "RD" if is_referible else "NRD",
            "xai": {
                "method":             xai_method,
                "original_image_b64": _to_base64(orig_u8),
                "heatmap_image_b64":  _to_base64(heatmap),
                "overlay_image_b64":  _to_base64(overlay),
            },
            "processing_time_ms": round((time.time() - t0) * 1000, 2),
            "model_version":      self.model_version,
            "module":             "diabetic_retinopathy",
            "disclaimer": (
                "RikunaLab — Módulo de Retinopatía Diabética. "
                "Herramienta de screening en atención primaria. "
                "No reemplaza la evaluación por un especialista en oftalmología."
            )
        }