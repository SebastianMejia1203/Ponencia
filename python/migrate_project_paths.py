#!/usr/bin/env python3
"""
Script de migración para actualizar proyectos existentes.

Este script elimina las rutas absolutas de los archivos project_config.json
para permitir que los proyectos sean portables (puedan moverse entre carpetas).

Las rutas absolutas (root, baseDir, dataYamlPath) ahora se calculan dinámicamente
al abrir el proyecto.

Uso:
    python migrate_project_paths.py <ruta_al_proyecto>
    python migrate_project_paths.py "C:\\Users\\okash\\Downloads\\Nueva carpeta (2)\\FrutasV2"
"""

import json
import sys
from pathlib import Path


def migrate_project_config(project_path: str) -> bool:
    """Migra un project_config.json para usar rutas relativas.
    
    Args:
        project_path: Ruta a la carpeta del proyecto
        
    Returns:
        bool: True si la migración fue exitosa
    """
    project_dir = Path(project_path).resolve()
    config_file = project_dir / 'project_config.json'
    
    if not config_file.exists():
        print(f'❌ No se encontró project_config.json en: {project_dir}')
        return False
    
    # Leer configuración actual
    with open(config_file, 'r', encoding='utf-8') as f:
        config = json.load(f)
    
    # Verificar si ya está migrado
    has_absolute_paths = any(key in config for key in ['root', 'baseDir', 'dataYamlPath'])
    
    if not has_absolute_paths:
        print(f'✅ El proyecto ya está migrado (no tiene rutas absolutas)')
        return True
    
    print(f'🔧 Migrando proyecto: {config.get("name", "Sin nombre")}')
    print(f'   📁 Ubicación: {project_dir}')
    
    # Mostrar rutas absolutas que serán removidas
    if 'root' in config:
        print(f'   🗑️  Removiendo "root": {config["root"]}')
    if 'baseDir' in config:
        print(f'   🗑️  Removiendo "baseDir": {config["baseDir"]}')
    if 'dataYamlPath' in config:
        print(f'   🗑️  Removiendo "dataYamlPath": {config["dataYamlPath"]}')
    
    # Crear copia sin rutas absolutas
    migrated_config = config.copy()
    migrated_config.pop('root', None)
    migrated_config.pop('baseDir', None)
    migrated_config.pop('dataYamlPath', None)
    
    # Crear backup del original
    backup_file = config_file.with_suffix('.json.backup')
    with open(backup_file, 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print(f'   💾 Backup creado: {backup_file.name}')
    
    # Guardar configuración migrada
    with open(config_file, 'w', encoding='utf-8') as f:
        json.dump(migrated_config, f, ensure_ascii=False, indent=2)
    
    print(f'   ✅ Migración completada exitosamente')
    print(f'\n📝 Nota: Las rutas se calcularán dinámicamente al abrir el proyecto')
    print(f'   Ahora puedes mover el proyecto a cualquier ubicación.')
    
    return True


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print('\n❌ Error: Debes proporcionar la ruta al proyecto')
        print('\nEjemplo:')
        print('    python migrate_project_paths.py "C:\\Users\\okash\\Downloads\\FrutasV2"')
        sys.exit(1)
    
    project_path = sys.argv[1]
    
    if not Path(project_path).exists():
        print(f'❌ Error: La ruta no existe: {project_path}')
        sys.exit(1)
    
    success = migrate_project_config(project_path)
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
