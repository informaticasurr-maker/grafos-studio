# 📊 Reporte Topológico de Red: Red Topológica de las Tablas de Multiplicar (0 al 9)

## 📐 Métricas Globales
- **Total de Nodos:** 37
- **Total de Aristas:** 127
- **Densidad de Red:** 0.08483
- **Aceleración:** NetworkX / SciPy

## 🌟 Top 10 Nodos Centrales (Mayor Conectividad)
| Nodo / ID | Etiqueta | Grado Total | Entrantes | Salientes | PageRank |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `num_6` | **[6]** | 22 | 9 | 13 | 0.02352 |
| `num_8` | **[8]** | 22 | 11 | 11 | 0.0258 |
| `num_4` | **[4]** | 21 | 6 | 15 | 0.02171 |
| `num_9` | **[9]** | 21 | 11 | 10 | 0.02713 |
| `num_2` | **[2]** | 20 | 3 | 17 | 0.02004 |
| `num_3` | **[3]** | 20 | 4 | 16 | 0.02084 |
| `num_5` | **[5]** | 20 | 6 | 14 | 0.02254 |
| `num_7` | **[7]** | 20 | 8 | 12 | 0.0246 |
| `num_1` | **[1]** | 19 | 1 | 18 | 0.01842 |
| `num_0` | **[0]** | 11 | 10 | 1 | 0.23221 |

## ⚡ Top 10 Nodos Atractores (PageRank)
| Nodo / ID | Etiqueta | PageRank | Betweenness | Grupo |
| :--- | :--- | :--- | :--- | :--- |
| `num_0` | **[0]** | 0.23221 | 0.0 | `absorbente` |
| `num_9` | **[9]** | 0.02713 | 0.02877 | `factor_digito` |
| `num_8` | **[8]** | 0.0258 | 0.02421 | `factor_digito` |
| `num_7` | **[7]** | 0.0246 | 0.02341 | `factor_primo` |
| `num_18` | **18** | 0.02447 | 0.0 | `alta_convergencia` |
| `num_24` | **24** | 0.02429 | 0.0 | `alta_convergencia` |
| `num_12` | **12** | 0.02372 | 0.0 | `alta_convergencia` |
| `num_6` | **[6]** | 0.02352 | 0.01389 | `factor_digito` |
| `num_5` | **[5]** | 0.02254 | 0.01429 | `factor_primo` |
| `num_36` | **36** | 0.02201 | 0.0 | `cuadrado_perfecto` |