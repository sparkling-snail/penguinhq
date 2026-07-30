"""
Agent implementations — one module per agent role.

Each module exports a single BaseAgent subclass. The runtime's AGENT_REGISTRY
maps role names to (module_path, class_name) tuples for lazy loading.
"""
