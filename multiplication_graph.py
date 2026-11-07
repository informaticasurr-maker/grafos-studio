#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generador Topológico de las Tablas de Multiplicar (0 al 9)
Recluta 22: ag-graph-visualizer-22

Modela la red completa de relaciones multiplicativas, convergencia de productos,
simetría conmutativa, cuadrados perfectos, ciclos modulares y resonancias aritméticas.
"""

import os
import sys
import json
from collections import defaultdict

# Intentar importar el motor local
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from graph_engine import EnterpriseGraphEngine


def is_prime(n: int) -> bool:
    if n < 2:
        return False
    for i in range(2, int(n**0.5) + 1):
        if n % i == 0:
            return False
    return True


def generate_multiplication_network(output_path: str = "multiplication_table_graph.json") -> dict:
    engine = EnterpriseGraphEngine(
        title="Red Topológica de las Tablas de Multiplicar (0 al 9)",
        directed=True
    )

    # 1. Analizar el universo de operaciones (10 x 10 = 100 operaciones)
    product_combinations = defaultdict(list)
    product_factors = defaultdict(set)
    perfect_squares = set()

    for a in range(10):
        for b in range(10):
            prod = a * b
            product_combinations[prod].append((a, b))
            product_factors[prod].add(a)
            product_factors[prod].add(b)
            if a == b:
                perfect_squares.add(prod)

    # Paletas de colores semánticos por familia matemática
    COLOR_FACTOR = "#38bdf8"       # Azul cian eléctrico (Factores generadores)
    COLOR_SQUARE = "#ec4899"       # Rosa fucsia brillante (Cuadrados perfectos)
    COLOR_ZERO = "#f43f5e"         # Rojo carmesí atractor (El Cero absorbente)
    COLOR_PRIME_PROD = "#10b981"   # Verde esmeralda (Productos primos p*1)
    COLOR_HIGH_COMP = "#a855f7"    # Púrpura neón (Altamente compuestos / múltiples caminos)
    COLOR_EVEN = "#3b82f6"         # Azul cobalto (Compuestos pares)
    COLOR_ODD = "#f59e0b"          # Ámbar dorado (Compuestos impares)

    # 2. Registrar Nodos de Factores Primarios (0 a 9)
    for digit in range(10):
        val = 22.0
        color = COLOR_FACTOR
        group = "factor_digito"
        if digit == 0:
            color = COLOR_ZERO
            group = "absorbente"
        elif digit == 1:
            color = "#64748b"
            group = "neutro"
        elif is_prime(digit):
            color = "#06b6d4"
            group = "factor_primo"

        engine.add_node(
            node_id=f"num_{digit}",
            label=f"[{digit}]",
            group=group,
            val=val,
            color=color,
            tipo="digito_base",
            valor_numerico=digit,
            es_primo=is_prime(digit),
            es_par=(digit % 2 == 0),
            cuadrado=digit * digit,
            descripcion=f"Dígito base generador {digit}"
        )

    # 3. Registrar Nodos de Productos (Valores resultantes únicos mayores a 9)
    for prod, combos in product_combinations.items():
        if prod in range(10):
            # Ya existe como dígito base, pero enriquecemos su peso por popularidad
            n = engine.nodes[f"num_{prod}"]
            n["val"] = 20.0 + (len(combos) * 1.5)
            n["metadata"]["caminos_multiplicacion"] = len(combos)
            n["metadata"]["combinaciones"] = [f"{a}x{b}" for a, b in combos]
            if prod in perfect_squares:
                n["metadata"]["es_cuadrado_perfecto"] = True
            continue

        # Productos de dos dígitos (10 al 81)
        combos_count = len(combos)
        val = 14.0 + (combos_count * 2.2)

        # Clasificación matemática del producto
        if prod in perfect_squares:
            color = COLOR_SQUARE
            group = "cuadrado_perfecto"
        elif combos_count >= 4:
            color = COLOR_HIGH_COMP
            group = "alta_convergencia"
        elif prod % 2 == 0:
            color = COLOR_EVEN
            group = "producto_par"
        else:
            color = COLOR_ODD
            group = "producto_impar"

        engine.add_node(
            node_id=f"num_{prod}",
            label=str(prod),
            group=group,
            val=val,
            color=color,
            tipo="producto_resultado",
            valor_numerico=prod,
            es_par=(prod % 2 == 0),
            es_primo=is_prime(prod),
            es_cuadrado_perfecto=(prod in perfect_squares),
            caminos_multiplicacion=combos_count,
            ultimo_digito=prod % 10,
            combinaciones=[f"{a}x{b}" for a, b in combos],
            descripcion=f"Producto {prod} generado por {combos_count} operaciones"
        )

    # 4. Registrar Aristas (Enlaces dirigidos de multiplicación y cruces)
    # Evitar duplicados de enlaces múltiples entre los mismos nodos sumando pesos
    edge_map = defaultdict(lambda: {"count": 0, "labels": [], "types": set()})

    for a in range(10):
        for b in range(10):
            prod = a * b
            src_a = f"num_{a}"
            src_b = f"num_{b}"
            target = f"num_{prod}"

            op_label = f"{a}×{b}={prod}"
            is_square = (a == b)

            # Enlace de a hacia prod
            k1 = (src_a, target)
            edge_map[k1]["count"] += 1
            edge_map[k1]["labels"].append(op_label)
            if is_square:
                edge_map[k1]["types"].add("resonancia_cuadrada")
            else:
                edge_map[k1]["types"].add("multiplicacion")

            # Si a != b, enlace de b hacia prod
            if a != b:
                k2 = (src_b, target)
                edge_map[k2]["count"] += 1
                edge_map[k2]["labels"].append(f"{b}×{a}={prod}")
                edge_map[k2]["types"].add("multiplicacion_conmutativa")

    # Inyectar aristas consolidadas en el motor
    for (src, tgt), edata in edge_map.items():
        w = float(edata["count"])
        types_str = "_".join(sorted(edata["types"]))
        label_summary = ", ".join(edata["labels"][:3])
        if len(edata["labels"]) > 3:
            label_summary += f" (+{len(edata['labels']) - 3})"

        # Color de arista según tipo
        if "resonancia_cuadrada" in types_str:
            e_color = "#f472b6"
        elif "conmutativa" in types_str:
            e_color = "#818cf8"
        else:
            e_color = "#38bdf8"

        engine.add_edge(
            source=src,
            target=tgt,
            weight=w,
            label=label_summary,
            edge_type=types_str,
            color=e_color,
            operaciones=edata["labels"]
        )

    # 5. Enlaces cruzados de simetría conmutativa pura entre factores complementarios
    # (Ejemplo: el par 3 y 4 se conectan porque co-producen el 12)
    seen_pairs = set()
    for prod, combos in product_combinations.items():
        if prod == 0:
            continue  # El cero conecta con todo pero saturaría las aristas complementarias
        for a, b in combos:
            if a != b:
                pair = tuple(sorted([a, b]))
                if pair not in seen_pairs:
                    seen_pairs.add(pair)
                    engine.add_edge(
                        source=f"num_{pair[0]}",
                        target=f"num_{pair[1]}",
                        weight=1.0,
                        label=f"Co-factores de {prod}",
                        edge_type="co_factores",
                        color="#475569"
                    )

    # Exportar archivo JSON
    engine.export_json(output_path)

    # Exportar reporte en Markdown
    report_path = output_path.replace(".json", "_reporte.md")
    engine.export_markdown_report(report_path)

    return engine.to_dict()


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "multiplication_table_graph.json")
    venv_python = "/home/ac3v32/Escritorio/IDE ANTIGRAVITY/laboratorio-grafos/.venv/bin/python"
    print(f"[*] Ejecutando modelado matemático de tablas de multiplicar...")
    res = generate_multiplication_network(out)
    meta = res["graph_metadata"]
    print(f"[OK] Grafo generado con {meta['node_count']} nodos y {meta['edge_count']} aristas.")
