#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Graph Engine Enterprise (Recluta 22: ag-graph-visualizer-22)
Motor de análisis matemático de grafos, cálculo de métricas topológicas y exportación políglota.
"""

import sys
import os
import json
import math
import argparse
from typing import Dict, List, Any, Optional

# Carga condicional de NetworkX / SciPy
try:
    import networkx as nx
    HAS_NETWORKX = True
except ImportError:
    HAS_NETWORKX = False


class EnterpriseGraphEngine:
    """
    Motor topológico de grafos con soporte híbrido:
    Aceleración mediante NetworkX + Fallback nativo determinista.
    """

    def __init__(self, title: str = "Enterprise Graph", directed: bool = True):
        self.title = title
        self.directed = directed
        self.nodes: Dict[str, Dict[str, Any]] = {}
        self.edges: List[Dict[str, Any]] = []

    def add_node(self, node_id: str, label: Optional[str] = None, group: str = "default",
                 val: float = 10.0, color: Optional[str] = None, **metadata) -> None:
        """Añade o actualiza un nodo en el grafo."""
        str_id = str(node_id)
        self.nodes[str_id] = {
            "id": str_id,
            "label": str(label if label is not None else node_id),
            "group": group,
            "val": float(val),
            "color": color,
            "metadata": metadata
        }

    def add_edge(self, source: str, target: str, weight: float = 1.0,
                 label: str = "", edge_type: str = "default", color: Optional[str] = None, **metadata) -> None:
        """Añade una arista dirigida o bidireccional."""
        self.edges.append({
            "source": str(source),
            "target": str(target),
            "weight": float(weight),
            "label": label,
            "type": edge_type,
            "color": color,
            "metadata": metadata
        })

    def to_networkx(self):
        """Convierte la estructura interna a un objeto NetworkX DiGraph o Graph."""
        if not HAS_NETWORKX:
            return None
        G = nx.DiGraph() if self.directed else nx.Graph()
        for nid, data in self.nodes.items():
            G.add_node(nid, **data)
        for edge in self.edges:
            attrs = {k: v for k, v in edge.items() if k not in ("source", "target")}
            G.add_edge(edge["source"], edge["target"], **attrs)
        return G

    def compute_metrics(self) -> Dict[str, Any]:
        """
        Calcula métricas topológicas:
        - Grado (In-degree, Out-degree, Total)
        - Betweenness Centrality (Intermediación)
        - PageRank
        - Closeness Centrality
        - Densidad y componentes
        """
        # Grados locales básicos
        in_degrees: Dict[str, int] = {nid: 0 for nid in self.nodes}
        out_degrees: Dict[str, int] = {nid: 0 for nid in self.nodes}
        
        for e in self.edges:
            s, t = e["source"], e["target"]
            if s in out_degrees:
                out_degrees[s] += 1
            if t in in_degrees:
                in_degrees[t] += 1

        betweenness = {}
        pagerank = {}
        closeness = {}
        communities = {}
        density = 0.0

        if HAS_NETWORKX:
            G = self.to_networkx()
            if G and len(G) > 0:
                density = float(nx.density(G))
                try:
                    betweenness = nx.betweenness_centrality(G, weight="weight")
                except Exception:
                    betweenness = {n: 0.0 for n in G.nodes}
                
                try:
                    pagerank = nx.pagerank(G, weight="weight")
                except Exception:
                    pagerank = {n: 1.0 / len(G.nodes) for n in G.nodes}

                try:
                    closeness = nx.closeness_centrality(G)
                except Exception:
                    closeness = {n: 0.0 for n in G.nodes}

                # Comunidades (modularidad o componentes)
                try:
                    undirected_G = G.to_undirected()
                    comms = list(nx.community.greedy_modularity_communities(undirected_G))
                    for idx, comm in enumerate(comms):
                        for node in comm:
                            communities[node] = f"cluster_{idx}"
                except Exception:
                    pass
        else:
            # Fallback determinista
            n_count = len(self.nodes)
            max_edges = n_count * (n_count - 1) if n_count > 1 else 1
            density = len(self.edges) / max_edges if max_edges > 0 else 0.0
            for nid in self.nodes:
                deg = in_degrees.get(nid, 0) + out_degrees.get(nid, 0)
                betweenness[nid] = deg / (2.0 * max_edges) if max_edges > 0 else 0.0
                pagerank[nid] = (1.0 + in_degrees.get(nid, 0)) / (n_count + len(self.edges))
                closeness[nid] = deg / n_count if n_count > 0 else 0.0

        # Enriquecer metadatos de cada nodo
        for nid, data in self.nodes.items():
            in_d = in_degrees.get(nid, 0)
            out_d = out_degrees.get(nid, 0)
            total_d = in_d + out_d
            data["metadata"]["in_degree"] = in_d
            data["metadata"]["out_degree"] = out_d
            data["metadata"]["total_degree"] = total_d
            data["metadata"]["betweenness"] = round(float(betweenness.get(nid, 0.0)), 5)
            data["metadata"]["pagerank"] = round(float(pagerank.get(nid, 0.0)), 5)
            data["metadata"]["closeness"] = round(float(closeness.get(nid, 0.0)), 5)
            if nid in communities:
                data["metadata"]["detected_community"] = communities[nid]

        metrics_summary = {
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
            "density": round(density, 5),
            "has_networkx": HAS_NETWORKX
        }
        return metrics_summary

    def to_dict(self) -> Dict[str, Any]:
        """Serializa a formato JSON estándar para D3 y Vis-Network."""
        metrics = self.compute_metrics()
        return {
            "graph_metadata": {
                "title": self.title,
                "directed": self.directed,
                "node_count": len(self.nodes),
                "edge_count": len(self.edges),
                "metrics": metrics
            },
            "nodes": list(self.nodes.values()),
            "edges": self.edges
        }

    def export_json(self, filepath: str) -> None:
        """Exporta el grafo a archivo JSON formateado."""
        data = self.to_dict()
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"[OK] Grafo exportado exitosamente a JSON: {filepath}")

    def export_mermaid(self, filepath: str) -> None:
        """Exporta la topología a diagrama de flujo Mermaid."""
        lines = ["flowchart TD"]
        for nid, data in self.nodes.items():
            lbl = data["label"].replace('"', "'")
            lines.append(f'  {nid}["{lbl}"]')
        for e in self.edges:
            s, t = e["source"], e["target"]
            lbl = e["label"]
            if lbl:
                lines.append(f'  {s} -- "{lbl}" --> {t}')
            else:
                lines.append(f'  {s} --> {t}')
        with open(filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        print(f"[OK] Grafo exportado a Mermaid: {filepath}")

    def export_markdown_report(self, filepath: str) -> None:
        """Genera un reporte analítico topológico en Markdown."""
        metrics = self.compute_metrics()
        # Top nodos por grado
        sorted_by_degree = sorted(
            self.nodes.values(),
            key=lambda x: x["metadata"].get("total_degree", 0),
            reverse=True
        )[:10]

        # Top nodos por PageRank
        sorted_by_pagerank = sorted(
            self.nodes.values(),
            key=lambda x: x["metadata"].get("pagerank", 0),
            reverse=True
        )[:10]

        md = [
            f"# 📊 Reporte Topológico de Red: {self.title}",
            "",
            "## 📐 Métricas Globales",
            f"- **Total de Nodos:** {metrics['node_count']}",
            f"- **Total de Aristas:** {metrics['edge_count']}",
            f"- **Densidad de Red:** {metrics['density']}",
            f"- **Aceleración:** {'NetworkX / SciPy' if HAS_NETWORKX else 'Pure Python Engine'}",
            "",
            "## 🌟 Top 10 Nodos Centrales (Mayor Conectividad)",
            "| Nodo / ID | Etiqueta | Grado Total | Entrantes | Salientes | PageRank |",
            "| :--- | :--- | :--- | :--- | :--- | :--- |"
        ]
        for n in sorted_by_degree:
            m = n["metadata"]
            md.append(f"| `{n['id']}` | **{n['label']}** | {m.get('total_degree', 0)} | {m.get('in_degree', 0)} | {m.get('out_degree', 0)} | {m.get('pagerank', 0.0)} |")

        md.extend([
            "",
            "## ⚡ Top 10 Nodos Atractores (PageRank)",
            "| Nodo / ID | Etiqueta | PageRank | Betweenness | Grupo |",
            "| :--- | :--- | :--- | :--- | :--- |"
        ])
        for n in sorted_by_pagerank:
            m = n["metadata"]
            md.append(f"| `{n['id']}` | **{n['label']}** | {m.get('pagerank', 0.0)} | {m.get('betweenness', 0.0)} | `{n.get('group', 'default')}` |")

        with open(filepath, "w", encoding="utf-8") as f:
            f.write("\n".join(md))
        print(f"[OK] Reporte analítico guardado en: {filepath}")


def main():
    parser = argparse.ArgumentParser(description="Enterprise Graph Engine CLI - Recluta 22")
    parser.add_argument("--demo", action="store_true", help="Genera un grafo de demostración")
    parser.add_argument("--export-json", type=str, default="graph.json", help="Ruta del archivo JSON de salida")
    parser.add_argument("--export-report", type=str, default=None, help="Ruta de reporte Markdown")
    args = parser.parse_args()

    engine = EnterpriseGraphEngine(title="Demo Graph", directed=True)
    if args.demo:
        for i in range(1, 6):
            engine.add_node(f"node_{i}", label=f"Servicio {i}", group="core", val=15)
        engine.add_edge("node_1", "node_2", weight=2.0, label="dependencia")
        engine.add_edge("node_2", "node_3", weight=1.5, label="replica")
        engine.add_edge("node_3", "node_4", weight=1.0, label="cola")
        engine.add_edge("node_4", "node_5", weight=3.0, label="cache")
        engine.add_edge("node_5", "node_1", weight=2.5, label="bucle_control")
        engine.export_json(args.export_json)
        if args.export_report:
            engine.export_markdown_report(args.export_report)


if __name__ == "__main__":
    main()
