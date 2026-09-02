"""
glaucoscan_model.py
-------------------
Definición de la arquitectura del modelo GlaucoScan AI.

Arquitectura:
    Backbone : EfficientNet-B3 preentrenado en ImageNet (via timm)
    Cabeza   : Dropout → Linear(1536→256) → BN → ReLU → Dropout → Linear(256→1)
    Salida   : logit escalar (sigmoid se aplica en inferencia)

Esta clase debe ser idéntica a la usada durante el entrenamiento
para garantizar compatibilidad al cargar los pesos guardados.
"""

import os
from pathlib import Path

import timm
import torch
import torch.nn as nn


class GlaucoScanModel(nn.Module):
    """
    Modelo de clasificación binaria para detección de glaucoma
    mediante análisis de fotografías fundus.

    Args:
        model_name : nombre del backbone en timm (default: efficientnet_b3)
        dropout    : tasa de dropout para regularización (default: 0.4)
    """

    def __init__(
        self,
        model_name: str = "efficientnet_b3",
        dropout: float = 0.4
    ):
        super().__init__()

        # Backbone preentrenado — sin cabeza de clasificación
        # pretrained=False porque cargamos nuestros propios pesos
        # global_pool='avg': average pooling sobre el feature map final
        self.backbone = timm.create_model(
            model_name,
            pretrained=False,
            num_classes=0,
            global_pool="avg"
        )

        # Dimensión de salida del backbone EfficientNet-B3 = 1536
        backbone_out_dim = self.backbone.num_features

        # Cabeza de clasificación binaria con regularización
                # Cabeza de clasificación — idéntica a la del entrenamiento
        self.classifier = nn.Sequential(
            nn.Dropout(p=dropout),
            nn.Linear(backbone_out_dim, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(p=dropout / 2),
            nn.Linear(256, 1)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass del modelo.

        Args:
            x: tensor (B, 3, H, W) — batch de imágenes normalizadas

        Returns:
            logits: tensor (B, 1) — sin sigmoid aplicado
        """
        features = self.backbone(x)        # (B, 1536)
        logits   = self.classifier(features)  # (B, 1)
        return logits


def load_model(
    checkpoint_path: str,
    model_name: str = "efficientnet_b3",
    dropout: float = 0.4,
    device: str = "cuda"
) -> GlaucoScanModel:
    """
    Carga el modelo desde un checkpoint guardado con torch.save.

    Centraliza la carga del modelo para evitar duplicación
    de lógica entre inference.py y otros módulos.

    Args:
        checkpoint_path : ruta al archivo .pth con los pesos
        model_name      : debe coincidir con el usado en entrenamiento
        dropout         : debe coincidir con el usado en entrenamiento
        device          : 'cuda' o 'cpu'

    Returns:
        Modelo en modo eval listo para inferencia

    Raises:
        FileNotFoundError : si el checkpoint no existe
        RuntimeError      : si los pesos son incompatibles
    """
    if not os.path.exists(checkpoint_path):
        raise FileNotFoundError(
            f"Checkpoint no encontrado: {checkpoint_path}\n"
            "Verifica que el entrenamiento haya completado correctamente."
        )

    model = GlaucoScanModel(model_name=model_name, dropout=dropout)

    state_dict = torch.load(
        checkpoint_path,
        map_location=torch.device(device),
        weights_only=True   # seguridad: solo carga tensores
    )

    model.load_state_dict(state_dict)
    model.to(torch.device(device))
    model.eval()  # desactiva dropout y batchnorm en modo training

    return model