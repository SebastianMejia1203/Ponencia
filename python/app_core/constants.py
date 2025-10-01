from pathlib import Path

PROJECT_STATE_FILE = 'project_config.json'
ANNOTATIONS_DIR = 'annotations'
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}

def ensure_dir(path: Path):
    path.mkdir(parents=True, exist_ok=True)
    return path
