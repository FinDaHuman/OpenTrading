import ast
import importlib
from pathlib import Path

PACKAGE_NAME = "opentrading"
PACKAGE = Path(__file__).resolve().parents[2] / "src" / PACKAGE_NAME

ALLOWED_INTERNAL_DEPENDENCIES: dict[str, frozenset[str]] = {
    "config": frozenset({"config"}),
    "contracts": frozenset({"contracts"}),
    "domain": frozenset({"contracts", "domain"}),
    "errors": frozenset({"errors"}),
    "ports": frozenset({"contracts", "domain", "errors", "ports"}),
    "runtime": frozenset({"contracts", "domain", "errors", "ports", "runtime"}),
    "application": frozenset(
        {"application", "config", "contracts", "domain", "errors", "ports", "runtime"}
    ),
    "adapters": frozenset({"adapters", "config", "contracts", "domain", "errors", "ports"}),
    "interfaces": frozenset(
        {"application", "bootstrap", "config", "contracts", "domain", "errors", "interfaces"}
    ),
    "bootstrap": frozenset(
        {
            "adapters",
            "application",
            "bootstrap",
            "config",
            "contracts",
            "domain",
            "errors",
            "ports",
            "runtime",
        }
    ),
}
INTERNAL_LAYERS = frozenset(ALLOWED_INTERNAL_DEPENDENCIES)
FORBIDDEN_FOUNDATION_IMPORTS = (
    "httpx",
    "sqlalchemy",
    "textual",
    "typer",
    "openai",
    "anthropic",
    "google.generativeai",
)


def module_name(path: Path) -> str:
    relative = path.relative_to(PACKAGE).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join((PACKAGE_NAME, *parts))


def resolve_from_import(current: str, module: str | None, level: int, *, is_package: bool) -> str:
    if level == 0:
        return module or ""
    current_parts = current.split(".")
    package_parts = current_parts if is_package else current_parts[:-1]
    base = package_parts[: len(package_parts) - level + 1]
    return ".".join((*base, *((module or "").split("."))))


def imported_modules(path: Path) -> set[str]:
    current = module_name(path)
    tree = ast.parse(path.read_text(encoding="utf-8"))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            base = resolve_from_import(
                current, node.module, node.level, is_package=path.name == "__init__.py"
            )
            modules.add(base)
            modules.update(f"{base}.{alias.name}" for alias in node.names)
    return modules


def layer(module: str) -> str | None:
    parts = module.split(".")
    if not parts or parts[0] != PACKAGE_NAME or len(parts) < 2:
        return None
    return parts[1] if parts[1] in INTERNAL_LAYERS else None


def paths_for_layer(owner: str) -> tuple[Path, ...]:
    package_directory = PACKAGE / owner
    if package_directory.is_dir():
        return tuple(package_directory.rglob("*.py"))
    module = package_directory.with_suffix(".py")
    return (module,) if module.exists() else ()


def test_all_nested_modules_follow_dependency_direction() -> None:
    violations: list[str] = []
    for path in PACKAGE.rglob("*.py"):
        owner = layer(module_name(path))
        if owner is None:
            continue
        allowed = ALLOWED_INTERNAL_DEPENDENCIES[owner]
        for imported in imported_modules(path):
            dependency = layer(imported)
            if dependency is not None and dependency not in allowed:
                violations.append(f"{path.relative_to(PACKAGE)}: {owner} -> {dependency}")
    assert violations == []


def test_foundation_layers_have_no_infrastructure_imports() -> None:
    violations: list[str] = []
    for owner in ("config", "contracts", "domain", "errors", "ports"):
        for path in paths_for_layer(owner):
            for imported in imported_modules(path):
                if imported.startswith(FORBIDDEN_FOUNDATION_IMPORTS):
                    violations.append(f"{path.relative_to(PACKAGE)}: {imported}")
    assert violations == []


def test_root_from_import_exposes_imported_internal_layer() -> None:
    node = ast.parse(f"from {PACKAGE_NAME} import adapters").body[0]
    assert isinstance(node, ast.ImportFrom)
    base = resolve_from_import(
        f"{PACKAGE_NAME}.domain.example", node.module, node.level, is_package=False
    )
    imported = {base, *(f"{base}.{alias.name}" for alias in node.names)}
    assert "adapters" in {layer(module) for module in imported}


def test_all_package_modules_import_without_external_side_effect_setup() -> None:
    for path in PACKAGE.rglob("*.py"):
        name = module_name(path)
        if name != PACKAGE_NAME:
            importlib.import_module(name)
