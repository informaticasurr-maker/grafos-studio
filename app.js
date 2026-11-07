/**
 * GraphStudio Enterprise - Core Application Engine
 * Recluta 22: ag-graph-visualizer-22
 * 
 * Implementa renderizado D3.js v7, layouts dinámicos, minimap en Canvas,
 * filtros topológicos, inspector de nodos y Bóveda BYOK Zero-Knowledge con AES-GCM.
 */

// ============================================================================
// 1. Estado Global de la Aplicación
// ============================================================================
const state = {
  graphData: { nodes: [], edges: [], graph_metadata: {} },
  activeLayout: 'force',
  selectedNode: null,
  activeFilters: {
    minDegree: 0,
    showEdgeLabels: true,
    highlightEgo: true,
    activeGroups: new Set()
  },
  physics: {
    charge: -350,
    distance: 80,
    gravity: 0.15,
    collision: 25,
    frozen: false
  },
  vault: {
    provider: 'gemini',
    hasKey: false,
    keyCrypto: null // WebCrypto CryptoKey
  },
  simulation: null,
  zoomTransform: d3.zoomIdentity,
  d3Elements: {
    svg: null,
    gZoom: null,
    linkGroup: null,
    nodeGroup: null,
    labelGroup: null,
    zoomBehavior: null
  }
};

// ============================================================================
// 2. Bóveda Zero-Knowledge (Web Cryptography API - AES-256-GCM + Fallback RAM)
// ============================================================================
class ZeroKnowledgeVault {
  constructor() {
    this.sessionKey = null;
    this.encryptedKeyBlob = null;
    this.iv = null;
    this.inMemoryFallback = null;
    this.hasSubtle = !!(window.crypto && window.crypto.subtle);
  }

  async init() {
    if (!this.hasSubtle) return;
    try {
      this.sessionKey = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false, // No exportable
        ["encrypt", "decrypt"]
      );
    } catch (e) {
      console.warn("[VAULT] WebCrypto restringido, usando memoria volátil RAM.", e);
      this.hasSubtle = false;
    }
  }

  async storeKey(plainTextKey) {
    if (!plainTextKey || typeof plainTextKey !== 'string') {
      this.purge();
      return false;
    }
    const cleanKey = plainTextKey.trim().replace(/^["']|["']$/g, '');
    if (!cleanKey) {
      this.purge();
      return false;
    }

    if (this.hasSubtle) {
      try {
        if (!this.sessionKey) await this.init();
        const enc = new TextEncoder();
        this.iv = window.crypto.getRandomValues(new Uint8Array(12));
        this.encryptedKeyBlob = await window.crypto.subtle.encrypt(
          { name: "AES-GCM", iv: this.iv },
          this.sessionKey,
          enc.encode(cleanKey)
        );
      } catch (err) {
        console.warn("[VAULT] Error cifrando con subtle, almacenando en memoria volátil:", err);
        this.inMemoryFallback = cleanKey;
      }
    } else {
      this.inMemoryFallback = cleanKey;
    }

    state.vault.hasKey = true;
    this.updateUIStatus(true);
    return true;
  }

  async retrieveKey() {
    if (this.inMemoryFallback) return this.inMemoryFallback;
    if (!this.encryptedKeyBlob || !this.sessionKey || !this.iv) return null;
    try {
      const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: this.iv },
        this.sessionKey,
        this.encryptedKeyBlob
      );
      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error("[VAULT ERROR] Fallo al descifrar:", e);
      return this.inMemoryFallback || null;
    }
  }

  purge() {
    this.sessionKey = null;
    this.encryptedKeyBlob = null;
    this.iv = null;
    this.inMemoryFallback = null;
    state.vault.hasKey = false;
    this.updateUIStatus(false);
  }

  updateUIStatus(isOnline) {
    const statusDot = document.getElementById('vaultStatusIndicator');
    const statusBox = document.getElementById('vaultStatusBox');
    const msg = document.getElementById('vaultStatusMessage');

    if (isOnline) {
      statusDot.className = 'vault-status-dot online';
      if (statusBox) statusBox.querySelector('.status-bullet').className = 'status-bullet online';
      if (msg) msg.innerHTML = `<strong>Bóveda Activa:</strong> Clave cifrada y lista para llamadas directas (${state.vault.provider.toUpperCase()}).`;
    } else {
      statusDot.className = 'vault-status-dot offline';
      if (statusBox) statusBox.querySelector('.status-bullet').className = 'status-bullet offline';
      if (msg) msg.textContent = 'Estado: Bóveda en reposo (Modo Local / No-AI Activo).';
    }
  }
}

const vault = new ZeroKnowledgeVault();

// ============================================================================
// 3. Inicialización del DOM y Eventos
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  await vault.init();
  setupD3Svg();
  setupEventListeners();
  setupMinimap();
  
  // Cargar Dataset Inicial (Tablas de Multiplicar)
  loadDataset('multiplication');
});

function setupD3Svg() {
  const container = document.getElementById('canvasContainer');
  const svg = d3.select('#graphSvg')
    .attr('width', '100%')
    .attr('height', '100%');

  // Marcador de flecha para aristas dirigidas
  const defs = svg.append('defs');
  defs.append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 22)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#94a3b8')
    .attr('opacity', 0.6);

  // Grupo principal para Zoom / Pan
  const gZoom = svg.append('g').attr('class', 'main-zoom-group');
  const linkGroup = gZoom.append('g').attr('class', 'links-layer');
  const labelGroup = gZoom.append('g').attr('class', 'edge-labels-layer');
  const nodeGroup = gZoom.append('g').attr('class', 'nodes-layer');

  // Zoom Behavior
  const zoomBehavior = d3.zoom()
    .scaleExtent([0.1, 8])
    .on('zoom', (event) => {
      state.zoomTransform = event.transform;
      gZoom.attr('transform', event.transform);
      renderMinimap();
    });

  svg.call(zoomBehavior);

  state.d3Elements = { svg, gZoom, linkGroup, nodeGroup, labelGroup, zoomBehavior };
}

function setupEventListeners() {
  // Selector de dataset
  const datasetSelect = document.getElementById('datasetSelect');
  datasetSelect.addEventListener('change', (e) => {
    if (e.target.value === 'custom') {
      document.getElementById('jsonFileInput').click();
    } else {
      loadDataset(e.target.value);
    }
  });

  document.getElementById('jsonFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          initGraphWithData(data);
          showToast(`Dataset "${file.name}" cargado exitosamente.`);
        } catch (err) {
          alert('Error al leer el archivo JSON: ' + err.message);
        }
      };
      reader.readAsText(file);
    }
  });

  // Selector de Layouts
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      applyLayout(targetBtn.dataset.layout);
    });
  });

  // Controles de Física Sliders
  setupSlider('chargeSlider', 'chargeVal', (val) => {
    state.physics.charge = val;
    if (state.simulation) {
      state.simulation.force('charge', d3.forceManyBody().strength(val));
      state.simulation.alpha(0.3).restart();
    }
  });

  setupSlider('distanceSlider', 'distanceVal', (val) => {
    state.physics.distance = val;
    if (state.simulation) {
      state.simulation.force('link').distance(val);
      state.simulation.alpha(0.3).restart();
    }
  });

  setupSlider('gravitySlider', 'gravityVal', (val) => {
    state.physics.gravity = val;
    const { width, height } = getCanvasSize();
    if (state.simulation) {
      state.simulation.force('center', d3.forceCenter(width / 2, height / 2).strength(val));
      state.simulation.alpha(0.3).restart();
    }
  }, true);

  setupSlider('collisionSlider', 'collisionVal', (val) => {
    state.physics.collision = val;
    if (state.simulation) {
      state.simulation.force('collision', d3.forceCollide().radius(d => (d.val || 12) + val));
      state.simulation.alpha(0.3).restart();
    }
  });

  document.getElementById('freezePhysicsToggle').addEventListener('change', (e) => {
    state.physics.frozen = e.target.checked;
    if (state.simulation) {
      if (state.physics.frozen) {
        state.simulation.stop();
        showToast('Física congelada. Posiciones fijadas.');
      } else {
        state.simulation.alpha(0.4).restart();
        showToast('Física reactivada.');
      }
    }
  });

  document.getElementById('resetPhysicsBtn').addEventListener('click', () => {
    document.getElementById('chargeSlider').value = -350;
    document.getElementById('distanceSlider').value = 80;
    document.getElementById('gravitySlider').value = 0.15;
    document.getElementById('collisionSlider').value = 25;
    document.getElementById('chargeVal').textContent = '-350';
    document.getElementById('distanceVal').textContent = '80';
    document.getElementById('gravityVal').textContent = '0.15';
    document.getElementById('collisionVal').textContent = '25';
    state.physics.charge = -350;
    state.physics.distance = 80;
    state.physics.gravity = 0.15;
    state.physics.collision = 25;
    applyLayout('force');
    showToast('Parámetros de física reestablecidos.');
  });

  // Filtro por grado mínimo
  setupSlider('degreeFilterSlider', 'degreeFilterVal', (val) => {
    state.activeFilters.minDegree = val;
    applyFilters();
  });

  document.getElementById('showEdgeLabelsToggle').addEventListener('change', (e) => {
    state.activeFilters.showEdgeLabels = e.target.checked;
    state.d3Elements.labelGroup.style('display', e.target.checked ? 'block' : 'none');
  });

  document.getElementById('highlightEgoToggle').addEventListener('change', (e) => {
    state.activeFilters.highlightEgo = e.target.checked;
  });

  // Búsqueda de nodos con autocompletado
  setupNodeSearch();

  // Zoom Controls
  document.getElementById('zoomInBtn').addEventListener('click', () => {
    state.d3Elements.svg.transition().duration(250).call(state.d3Elements.zoomBehavior.scaleBy, 1.3);
  });
  document.getElementById('zoomOutBtn').addEventListener('click', () => {
    state.d3Elements.svg.transition().duration(250).call(state.d3Elements.zoomBehavior.scaleBy, 0.7);
  });
  document.getElementById('zoomResetBtn').addEventListener('click', () => {
    fitViewToCenter();
  });
  document.getElementById('fitViewBtn').addEventListener('click', fitViewToCenter);

  // Pantalla completa
  document.getElementById('toggleFullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });

  // Exportar Dropdown
  const exportBtn = document.getElementById('exportDropdownBtn');
  const dropdown = exportBtn.closest('.dropdown');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });
  document.addEventListener('click', () => dropdown.classList.remove('open'));

  document.getElementById('exportPngBtn').addEventListener('click', (e) => {
    e.preventDefault();
    exportToPng();
  });
  document.getElementById('exportSvgBtn').addEventListener('click', (e) => {
    e.preventDefault();
    exportToSvg();
  });
  document.getElementById('exportJsonBtn').addEventListener('click', (e) => {
    e.preventDefault();
    exportToJson();
  });
  document.getElementById('exportMarkdownBtn').addEventListener('click', (e) => {
    e.preventDefault();
    exportToMarkdown();
  });

  // Bóveda de Seguridad (Modal)
  setupVaultModal();

  // Forjador de Grafos con IA (Modal)
  setupAiForgeModal();

  // Asistente AI
  setupAiAssistant();

  // Capas y Navegación Móvil (PWA Mobile-First)
  setupMobileLayers();
}

function setupSlider(sliderId, labelId, callback, isFloat = false) {
  const slider = document.getElementById(sliderId);
  const label = document.getElementById(labelId);
  slider.addEventListener('input', (e) => {
    const val = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
    label.textContent = val;
    callback(val);
  });
}

// ============================================================================
// 4. Carga y Modelado de Datos
// ============================================================================
async function loadDataset(datasetKey) {
  updateHudStatus('Cargando dataset...');
  if (datasetKey === 'multiplication') {
    try {
      const res = await fetch('multiplication_table_graph.json');
      if (!res.ok) throw new Error('No se pudo cargar el archivo local');
      const data = await res.json();
      initGraphWithData(data);
      showToast('Grafo de Tablas de Multiplicar (0 al 9) cargado.');
    } catch (err) {
      console.warn('[LOAD FALLBACK] Cargando datos inline de tablas de multiplicar...');
      generateFallbackMultiplicationData();
    }
  } else if (datasetKey === 'microservices') {
    generateMicroservicesDemoData();
    showToast('Arquitectura de Microservicios Cloud cargada.');
  }
}

function initGraphWithData(data) {
  state.graphData = data;
  updateGlobalMetrics(data);
  buildGroupBadges(data.nodes);
  applyLayout(state.activeLayout);
  updateHudStatus('Listo');
  setTimeout(fitViewToCenter, 400);
}

function generateFallbackMultiplicationData() {
  // Generador determinista cliente si fetch fallara
  const nodes = [];
  const edges = [];
  for (let i = 0; i < 10; i++) {
    nodes.push({
      id: `num_${i}`,
      label: `[${i}]`,
      group: i === 0 ? 'absorbente' : (i % 2 === 0 ? 'par' : 'impar'),
      val: 20,
      color: i === 0 ? '#f43f5e' : '#38bdf8',
      metadata: { total_degree: 18, pagerank: i === 0 ? 0.23 : 0.02 }
    });
  }
  for (let a = 0; a < 10; a++) {
    for (let b = 0; b < 10; b++) {
      const prod = a * b;
      const targetId = `num_${prod}`;
      if (!nodes.find(n => n.id === targetId)) {
        nodes.push({
          id: targetId,
          label: `${prod}`,
          group: prod % 2 === 0 ? 'producto_par' : 'producto_impar',
          val: 16,
          color: prod % 2 === 0 ? '#3b82f6' : '#f59e0b',
          metadata: { total_degree: 4, pagerank: 0.015 }
        });
      }
      edges.push({
        source: `num_${a}`,
        target: targetId,
        weight: 1,
        label: `${a}×${b}=${prod}`,
        type: 'multiplicacion'
      });
    }
  }
  initGraphWithData({
    graph_metadata: { title: "Tablas de Multiplicar (Fallback)", node_count: nodes.length, edge_count: edges.length },
    nodes,
    edges
  });
}

function generateMicroservicesDemoData() {
  const nodes = [
    { id: "api_gateway", label: "API Gateway", group: "edge", val: 28, color: "#38bdf8", metadata: { total_degree: 6, pagerank: 0.15 } },
    { id: "auth_service", label: "Auth & OAuth2", group: "security", val: 22, color: "#ec4899", metadata: { total_degree: 4, pagerank: 0.11 } },
    { id: "user_service", label: "User Management", group: "core", val: 20, color: "#a855f7", metadata: { total_degree: 4, pagerank: 0.08 } },
    { id: "order_service", label: "Order Processing", group: "business", val: 24, color: "#10b981", metadata: { total_degree: 5, pagerank: 0.12 } },
    { id: "payment_service", label: "Stripe & Payments", group: "fintech", val: 22, color: "#f59e0b", metadata: { total_degree: 3, pagerank: 0.09 } },
    { id: "inventory_service", label: "Inventory Warehouse", group: "logistics", val: 18, color: "#6366f1", metadata: { total_degree: 3, pagerank: 0.07 } },
    { id: "notification_svc", label: "Notifications & SMS", group: "infra", val: 18, color: "#06b6d4", metadata: { total_degree: 3, pagerank: 0.06 } },
    { id: "postgres_cluster", label: "PostgreSQL Primary", group: "database", val: 26, color: "#3b82f6", metadata: { total_degree: 5, pagerank: 0.14 } },
    { id: "redis_cache", label: "Redis Mesh Cache", group: "cache", val: 22, color: "#f43f5e", metadata: { total_degree: 4, pagerank: 0.10 } },
    { id: "kafka_broker", label: "Apache Kafka Bus", group: "messaging", val: 25, color: "#e11d48", metadata: { total_degree: 5, pagerank: 0.13 } }
  ];
  const edges = [
    { source: "api_gateway", target: "auth_service", weight: 3, label: "valida_jwt", color: "#38bdf8" },
    { source: "api_gateway", target: "user_service", weight: 2, label: "perfil", color: "#38bdf8" },
    { source: "api_gateway", target: "order_service", weight: 4, label: "checkout", color: "#38bdf8" },
    { source: "order_service", target: "payment_service", weight: 4, label: "cargo_tarjeta", color: "#10b981" },
    { source: "order_service", target: "inventory_service", weight: 3, label: "reserva_stock", color: "#10b981" },
    { source: "order_service", target: "kafka_broker", weight: 3, label: "order_created", color: "#10b981" },
    { source: "kafka_broker", target: "notification_svc", weight: 2, label: "consumidor_email", color: "#e11d48" },
    { source: "user_service", target: "postgres_cluster", weight: 3, label: "sql_queries", color: "#3b82f6" },
    { source: "order_service", target: "postgres_cluster", weight: 4, label: "transaccion_acid", color: "#3b82f6" },
    { source: "auth_service", target: "redis_cache", weight: 4, label: "session_tokens", color: "#f43f5e" }
  ];
  initGraphWithData({
    graph_metadata: { title: "Microservices Architecture", node_count: nodes.length, edge_count: edges.length },
    nodes,
    edges
  });
}

// ============================================================================
// 5. Motor de Renderizado y Layouts Topológicos
// ============================================================================
function applyLayout(layoutType) {
  state.activeLayout = layoutType;
  if (state.simulation) {
    state.simulation.stop();
  }

  const { width, height } = getCanvasSize();
  const nodes = state.graphData.nodes;
  const edges = state.graphData.edges;

  // Filtrado de nodos y aristas visibles
  const visibleNodes = nodes.filter(n => {
    const deg = (n.metadata && n.metadata.total_degree) || 0;
    const matchesDegree = deg >= state.activeFilters.minDegree;
    const matchesGroup = state.activeFilters.activeGroups.size === 0 || state.activeFilters.activeGroups.has(n.group);
    return matchesDegree && matchesGroup;
  });

  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = edges.filter(e => {
    const srcId = typeof e.source === 'object' ? e.source.id : e.source;
    const tgtId = typeof e.target === 'object' ? e.target.id : e.target;
    return visibleNodeIds.has(srcId) && visibleNodeIds.has(tgtId);
  });

  if (layoutType === 'force') {
    // D3 Force Directed
    state.simulation = d3.forceSimulation(visibleNodes)
      .force('link', d3.forceLink(visibleEdges).id(d => d.id).distance(state.physics.distance))
      .force('charge', d3.forceManyBody().strength(state.physics.charge))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(state.physics.gravity))
      .force('collision', d3.forceCollide().radius(d => (d.val || 12) + state.physics.collision))
      .on('tick', ticked);

    if (state.physics.frozen) {
      state.simulation.stop();
    }
  } else if (layoutType === 'concentric') {
    // Concéntrico: Nodos centrales por PageRank o Grado
    const sorted = [...visibleNodes].sort((a, b) => {
      const prA = (a.metadata && a.metadata.pagerank) || 0;
      const prB = (b.metadata && b.metadata.pagerank) || 0;
      return prB - prA;
    });

    const cx = width / 2;
    const cy = height / 2;
    const rings = 4;
    const itemsPerRing = Math.ceil(sorted.length / rings);

    sorted.forEach((node, idx) => {
      const ringIndex = Math.floor(idx / itemsPerRing);
      const posInRing = idx % itemsPerRing;
      const radius = 90 + (ringIndex * 110);
      const angle = (posInRing / itemsPerRing) * 2 * Math.PI;
      node.x = cx + radius * Math.cos(angle);
      node.y = cy + radius * Math.sin(angle);
      node.vx = 0;
      node.vy = 0;
    });
    updateElementsPositions(visibleNodes, visibleEdges);
  } else if (layoutType === 'circular') {
    // Circular: Distribución perimetral uniforme
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.38;
    const total = visibleNodes.length;

    visibleNodes.forEach((node, idx) => {
      const angle = (idx / total) * 2 * Math.PI;
      node.x = cx + radius * Math.cos(angle);
      node.y = cy + radius * Math.sin(angle);
      node.vx = 0;
      node.vy = 0;
    });
    updateElementsPositions(visibleNodes, visibleEdges);
  } else if (layoutType === 'grid') {
    // Grilla Matricial
    const cols = Math.ceil(Math.sqrt(visibleNodes.length * 1.5));
    const paddingX = 90;
    const paddingY = 85;
    const startX = (width - (cols * paddingX)) / 2 + 40;
    const startY = (height - (Math.ceil(visibleNodes.length / cols) * paddingY)) / 2 + 40;

    visibleNodes.forEach((node, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      node.x = startX + c * paddingX;
      node.y = startY + r * paddingY;
      node.vx = 0;
      node.vy = 0;
    });
    updateElementsPositions(visibleNodes, visibleEdges);
  }

  // Render D3 Layers
  renderD3Graph(visibleNodes, visibleEdges);
}

function renderD3Graph(nodes, edges) {
  const { linkGroup, labelGroup, nodeGroup } = state.d3Elements;

  // 1. ARISTAS (LINKS)
  const links = linkGroup.selectAll('.graph-link')
    .data(edges, d => `${d.source.id || d.source}->${d.target.id || d.target}`);

  links.exit().remove();

  const linksEnter = links.enter().append('line')
    .attr('class', 'graph-link')
    .attr('marker-end', 'url(#arrow)')
    .attr('stroke', d => d.color || '#64748b')
    .attr('stroke-width', d => Math.max(1, Math.min(5, (d.weight || 1) * 1.2)));

  const allLinks = linksEnter.merge(links);

  // 2. ETIQUETAS DE ARISTAS
  const labels = labelGroup.selectAll('.graph-edge-label')
    .data(edges, d => `${d.source.id || d.source}->${d.target.id || d.target}`);

  labels.exit().remove();

  const labelsEnter = labels.enter().append('text')
    .attr('class', 'graph-edge-label')
    .attr('text-anchor', 'middle')
    .attr('dy', -3)
    .text(d => d.label || '');

  const allLabels = labelsEnter.merge(labels);
  labelGroup.style('display', state.activeFilters.showEdgeLabels ? 'block' : 'none');

  // 3. NODOS
  const nodeSelection = nodeGroup.selectAll('.graph-node-group')
    .data(nodes, d => d.id);

  nodeSelection.exit().remove();

  const nodeEnter = nodeSelection.enter().append('g')
    .attr('class', 'graph-node-group')
    .call(d3.drag()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded)
    );

  // Círculo de nodo
  nodeEnter.append('circle')
    .attr('class', 'graph-node-circle')
    .attr('r', d => Math.max(8, d.val || 14))
    .attr('fill', d => d.color || '#38bdf8');

  // Etiqueta de texto de nodo
  nodeEnter.append('text')
    .attr('class', 'graph-node-label')
    .attr('text-anchor', 'middle')
    .attr('dy', 4)
    .text(d => d.label);

  const allNodes = nodeEnter.merge(nodeSelection);

  // Eventos de Hover y Click
  allNodes
    .on('mouseenter', (event, d) => onNodeHover(d))
    .on('mouseleave', () => onNodeLeave())
    .on('click', (event, d) => onNodeClick(d));

  // Actualizar HUD
  document.getElementById('hudNodeCount').textContent = nodes.length;
  document.getElementById('hudEdgeCount').textContent = edges.length;

  renderMinimap();
}

function ticked() {
  const { linkGroup, labelGroup, nodeGroup } = state.d3Elements;

  linkGroup.selectAll('.graph-link')
    .attr('x1', d => d.source.x)
    .attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x)
    .attr('y2', d => d.target.y);

  labelGroup.selectAll('.graph-edge-label')
    .attr('x', d => (d.source.x + d.target.x) / 2)
    .attr('y', d => (d.source.y + d.target.y) / 2);

  nodeGroup.selectAll('.graph-node-group')
    .attr('transform', d => `translate(${d.x},${d.y})`);

  renderMinimap();
}

function updateElementsPositions(nodes, edges) {
  ticked();
}

function dragStarted(event, d) {
  if (state.activeLayout === 'force' && !state.physics.frozen) {
    if (!event.active && state.simulation) state.simulation.alphaTarget(0.3).restart();
  }
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(event, d) {
  d.fx = event.x;
  d.fy = event.y;
  d.x = event.x;
  d.y = event.y;
  ticked();
}

function dragEnded(event, d) {
  if (state.activeLayout === 'force' && !state.physics.frozen) {
    if (!event.active && state.simulation) state.simulation.alphaTarget(0);
  }
  d.fx = null;
  d.fy = null;
}

// ============================================================================
// 6. Interacción: Hover, Click, Ego-Network Focus
// ============================================================================
function onNodeHover(node) {
  if (!state.activeFilters.highlightEgo) return;

  const connectedNodeIds = new Set([node.id]);
  const connectedEdgeSet = new Set();

  state.graphData.edges.forEach(e => {
    const sId = e.source.id || e.source;
    const tId = e.target.id || e.target;
    if (sId === node.id) {
      connectedNodeIds.add(tId);
      connectedEdgeSet.add(e);
    } else if (tId === node.id) {
      connectedNodeIds.add(sId);
      connectedEdgeSet.add(e);
    }
  });

  const { nodeGroup, linkGroup } = state.d3Elements;

  nodeGroup.selectAll('.graph-node-group')
    .classed('faded', d => !connectedNodeIds.has(d.id));

  linkGroup.selectAll('.graph-link')
    .classed('highlighted', d => connectedEdgeSet.has(d))
    .classed('faded', d => !connectedEdgeSet.has(d));
}

function onNodeLeave() {
  if (!state.activeFilters.highlightEgo) return;
  const { nodeGroup, linkGroup } = state.d3Elements;
  nodeGroup.selectAll('.graph-node-group').classed('faded', false);
  linkGroup.selectAll('.graph-link').classed('highlighted', false).classed('faded', false);
}

function onNodeClick(node) {
  state.selectedNode = node;
  const { nodeGroup } = state.d3Elements;
  nodeGroup.selectAll('.graph-node-group').classed('selected', d => d.id === node.id);
  renderNodeInspector(node);

  // En pantallas móviles: abrir automáticamente el Bottom Sheet del Inspector
  if (window.innerWidth <= 900 && typeof window.openMobileDrawer === 'function') {
    window.openMobileDrawer('sidebarRight');
    if (typeof setMobileTabActive === 'function') {
      setMobileTabActive('inspector');
    }
  }
}

// ============================================================================
// 7. Inspector de Nodos y Métricas
// ============================================================================
function renderNodeInspector(node) {
  const avatar = document.getElementById('inspectAvatar');
  const title = document.getElementById('inspectTitle');
  const badge = document.getElementById('inspectBadge');
  const body = document.getElementById('inspectorBody');

  avatar.textContent = node.label || node.id;
  avatar.style.borderColor = node.color || 'var(--accent-cyan)';
  avatar.style.color = node.color || 'var(--accent-cyan)';
  title.textContent = `Nodo: ${node.label || node.id}`;
  badge.textContent = node.group ? node.group.toUpperCase() : 'GENERAL';
  badge.style.color = node.color || 'var(--accent-cyan)';

  const m = node.metadata || {};
  const inDegree = m.in_degree !== undefined ? m.in_degree : '--';
  const outDegree = m.out_degree !== undefined ? m.out_degree : '--';
  const totalDegree = m.total_degree !== undefined ? m.total_degree : '--';
  const pageRank = m.pagerank !== undefined ? m.pagerank : '--';
  const betweenness = m.betweenness !== undefined ? m.betweenness : '--';

  let combosHtml = '';
  if (m.combinaciones && m.combinaciones.length > 0) {
    combosHtml = `
      <div class="detail-section-title">Operaciones de Multiplicación:</div>
      <div class="combos-tag-list">
        ${m.combinaciones.map(c => `<span class="combo-pill">${c}</span>`).join('')}
      </div>
    `;
  }

  // Vecinos conectados
  const incoming = [];
  const outgoing = [];
  state.graphData.edges.forEach(e => {
    const sId = e.source.id || e.source;
    const tId = e.target.id || e.target;
    if (sId === node.id) outgoing.push(tId);
    if (tId === node.id) incoming.push(sId);
  });

  body.innerHTML = `
    <div class="stat-grid">
      <div class="stat-box">
        <span class="title">Grado Total</span>
        <span class="number cyan">${totalDegree}</span>
      </div>
      <div class="stat-box">
        <span class="title">PageRank (Atractor)</span>
        <span class="number purple">${pageRank}</span>
      </div>
      <div class="stat-box">
        <span class="title">Entrantes (In)</span>
        <span class="number emerald">${inDegree}</span>
      </div>
      <div class="stat-box">
        <span class="title">Salientes (Out)</span>
        <span class="number pink">${outDegree}</span>
      </div>
    </div>

    ${combosHtml}

    <div class="detail-section-title">Conectividad de Red:</div>
    <div style="font-size: 0.75rem; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px;">
      <div><strong>Llegan desde (${incoming.length}):</strong> ${incoming.slice(0, 8).join(', ')}${incoming.length > 8 ? '...' : ''}</div>
      <div><strong>Se proyectan hacia (${outgoing.length}):</strong> ${outgoing.slice(0, 8).join(', ')}${outgoing.length > 8 ? '...' : ''}</div>
    </div>
  `;
}

function updateGlobalMetrics(data) {
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const meta = data.graph_metadata || {};

  document.getElementById('metricTotalNodes').textContent = nodes.length;
  document.getElementById('metricTotalEdges').textContent = edges.length;

  let topAttractor = '--';
  let maxDegree = 0;
  let topNode = null;

  nodes.forEach(n => {
    const deg = (n.metadata && n.metadata.total_degree) || 0;
    if (deg > maxDegree) {
      maxDegree = deg;
      topNode = n;
    }
  });

  // Top PageRank
  const sortedByPR = [...nodes].sort((a, b) => {
    const prA = (a.metadata && a.metadata.pagerank) || 0;
    const prB = (b.metadata && b.metadata.pagerank) || 0;
    return prB - prA;
  });

  if (sortedByPR.length > 0) {
    topAttractor = sortedByPR[0].label || sortedByPR[0].id;
  }

  document.getElementById('metricTopAttractor').textContent = topAttractor;
  document.getElementById('metricMaxDegree').textContent = maxDegree > 0 ? `${maxDegree} conn` : '--';

  const density = (meta.metrics && meta.metrics.density) || (nodes.length > 1 ? (edges.length / (nodes.length * (nodes.length - 1))).toFixed(4) : 0);
  document.getElementById('hudDensity').textContent = density;
}

// ============================================================================
// 8. Búsqueda y Navegación
// ============================================================================
function setupNodeSearch() {
  const input = document.getElementById('nodeSearchInput');
  const suggestions = document.getElementById('searchSuggestions');
  const clearBtn = document.getElementById('clearSearchBtn');

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) {
      suggestions.style.display = 'none';
      return;
    }

    const matches = state.graphData.nodes.filter(n => {
      const lbl = (n.label || '').toLowerCase();
      const id = (n.id || '').toLowerCase();
      const grp = (n.group || '').toLowerCase();
      return lbl.includes(q) || id.includes(q) || grp.includes(q);
    }).slice(0, 8);

    if (matches.length === 0) {
      suggestions.innerHTML = `<div class="search-item" style="color: var(--text-muted);">Sin coincidencias</div>`;
    } else {
      suggestions.innerHTML = matches.map(n => `
        <div class="search-item" data-id="${n.id}">
          <span><strong>${n.label}</strong> <small style="color: var(--text-muted);">(${n.group})</small></span>
          <span style="color: ${n.color || 'var(--accent-cyan)'}; font-family: var(--font-mono);">PR: ${(n.metadata && n.metadata.pagerank) || '--'}</span>
        </div>
      `).join('');
    }
    suggestions.style.display = 'block';
  });

  suggestions.addEventListener('click', (e) => {
    const item = e.target.closest('.search-item');
    if (item && item.dataset.id) {
      const node = state.graphData.nodes.find(n => n.id === item.dataset.id);
      if (node) {
        focusOnNode(node);
        onNodeClick(node);
        suggestions.style.display = 'none';
        input.value = node.label || node.id;
      }
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    suggestions.style.display = 'none';
    fitViewToCenter();
  });
}

function focusOnNode(node) {
  const { width, height } = getCanvasSize();
  const scale = 2.0;
  const x = -node.x * scale + width / 2;
  const y = -node.y * scale + height / 2;

  state.d3Elements.svg.transition()
    .duration(650)
    .call(
      state.d3Elements.zoomBehavior.transform,
      d3.zoomIdentity.translate(x, y).scale(scale)
    );
}

function fitViewToCenter() {
  const { width, height } = getCanvasSize();
  state.d3Elements.svg.transition()
    .duration(600)
    .call(
      state.d3Elements.zoomBehavior.transform,
      d3.zoomIdentity.translate(0, 0).scale(1)
    );
}

// ============================================================================
// 9. Badges de Familias y Filtros
// ============================================================================
function buildGroupBadges(nodes) {
  const groupMap = new Map();
  nodes.forEach(n => {
    const g = n.group || 'general';
    if (!groupMap.has(g)) {
      groupMap.set(g, { count: 0, color: n.color || '#38bdf8' });
    }
    groupMap.get(g).count++;
  });

  const container = document.getElementById('groupBadges');
  container.innerHTML = '';

  groupMap.forEach((info, groupName) => {
    const chip = document.createElement('div');
    chip.className = 'group-badge-chip active';
    chip.innerHTML = `<span class="color-dot" style="background: ${info.color};"></span> ${groupName} (${info.count})`;
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      if (chip.classList.contains('active')) {
        state.activeFilters.activeGroups.delete(groupName);
      } else {
        state.activeFilters.activeGroups.add(groupName);
      }
      applyFilters();
    });
    container.appendChild(chip);
  });
}

function applyFilters() {
  applyLayout(state.activeLayout);
}

// ============================================================================
// 10. Mini-map (Radar Topológico en Canvas)
// ============================================================================
function setupMinimap() {
  const canvas = document.getElementById('minimapCanvas');
  canvas.width = 160;
  canvas.height = 110;
}

function renderMinimap() {
  const canvas = document.getElementById('minimapCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const nodes = state.graphData.nodes || [];
  if (nodes.length === 0) return;

  // Encontrar bounds del grafo
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    if (n.x !== undefined) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
  });

  const gw = (maxX - minX) || 1;
  const gh = (maxY - minY) || 1;
  const scale = Math.min((w - 20) / gw, (h - 20) / gh);

  ctx.save();
  ctx.translate(10, 10);

  nodes.forEach(n => {
    if (n.x !== undefined) {
      const rx = (n.x - minX) * scale;
      const ry = (n.y - minY) * scale;
      ctx.beginPath();
      ctx.arc(rx, ry, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = n.color || '#38bdf8';
      ctx.fill();
    }
  });

  ctx.restore();
}

// ============================================================================
// 11. Modal Bóveda de Claves (Zero-Knowledge)
// ============================================================================
function setupVaultModal() {
  const openBtn = document.getElementById('openVaultBtn');
  const modal = document.getElementById('vaultModal');
  const closeBtn = document.getElementById('closeVaultBtn');
  const cancelBtn = document.getElementById('cancelVaultBtn');
  const saveBtn = document.getElementById('saveKeyBtn');
  const testBtn = document.getElementById('testKeyBtn');
  const purgeBtn = document.getElementById('purgeKeysBtn');
  const toggleKeyBtn = document.getElementById('toggleShowKeyBtn');
  const keyInput = document.getElementById('apiKeyInput');
  const providerSelect = document.getElementById('aiProviderSelect');
  const detectedTag = document.getElementById('detectedProviderTag');
  const keyHelper = document.getElementById('keyHelperMessage');
  const statusMsg = document.getElementById('vaultStatusMessage');

  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
  });

  const closeModal = () => modal.style.display = 'none';
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  toggleKeyBtn.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  // Auto-detección inteligente de proveedor al escribir o pegar la clave
  keyInput.addEventListener('input', (e) => {
    const val = e.target.value.trim().replace(/^["']|["']$/g, '');
    if (!val) {
      if (detectedTag) detectedTag.style.display = 'none';
      if (keyHelper) keyHelper.innerHTML = 'Auto-detecta tu proveedor al pegar la clave. Se cifra en memoria volátil sin persistencia en disco.';
      return;
    }

    if (val.startsWith('gsk_')) {
      providerSelect.value = 'groq';
      if (detectedTag) {
        detectedTag.textContent = '✓ Detectado: Groq (Ultra Rápido)';
        detectedTag.style.color = '#38bdf8';
        detectedTag.style.display = 'inline';
      }
      if (keyHelper) keyHelper.innerHTML = '<span style="color:#34d399;">✓ Clave Groq válida detectada. Lista para usar con Qwen 3.8.</span>';
    } else if (val.startsWith('nvapi-')) {
      providerSelect.value = 'nvidia';
      if (detectedTag) {
        detectedTag.textContent = '✓ Detectado: NVIDIA NIM';
        detectedTag.style.color = '#10b981';
        detectedTag.style.display = 'inline';
      }
      if (keyHelper) keyHelper.innerHTML = '<span style="color:#34d399;">✓ Clave NVIDIA NIM detectada. Lista para usar.</span>';
    } else if (val.startsWith('sk-or-')) {
      providerSelect.value = 'openrouter';
      if (detectedTag) {
        detectedTag.textContent = '✓ Detectado: OpenRouter';
        detectedTag.style.color = '#a855f7';
        detectedTag.style.display = 'inline';
      }
      if (keyHelper) keyHelper.innerHTML = '<span style="color:#34d399;">✓ Clave OpenRouter detectada.</span>';
    } else if (val.startsWith('AIzaSy')) {
      providerSelect.value = 'gemini';
      if (detectedTag) {
        detectedTag.textContent = '✓ Detectado: Google Gemini (AI Studio)';
        detectedTag.style.color = '#38bdf8';
        detectedTag.style.display = 'inline';
      }
      if (keyHelper) keyHelper.innerHTML = '<span style="color:#34d399;">✓ Clave oficial de Google AI Studio detectada.</span>';
    } else if (val.startsWith('AQ.')) {
      if (detectedTag) {
        detectedTag.textContent = '⚠️ Token OAuth / Antigravity';
        detectedTag.style.color = '#fb7185';
        detectedTag.style.display = 'inline';
      }
      if (keyHelper) keyHelper.innerHTML = '<span style="color:#fb7185;">⚠️ Esta clave ("AQ.") es un token OAuth interno, no una API Key de Google AI Studio ("AIzaSy..."). Si tienes tu clave que empieza con <strong>"gsk_" (Groq)</strong> o <strong>"nvapi-" (NVIDIA)</strong>, pégala aquí y funcionará de inmediato.</span>';
    } else if (val.startsWith('sk-')) {
      providerSelect.value = 'openai';
      if (detectedTag) {
        detectedTag.textContent = '✓ Detectado: OpenAI';
        detectedTag.style.color = '#10b981';
        detectedTag.style.display = 'inline';
      }
    }
  });

  // Botón Probar Conexión
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const rawKey = keyInput.value.trim().replace(/^["']|["']$/g, '');
      const provider = providerSelect.value;
      if (!rawKey) {
        showToast('Pega una clave primero para probar.');
        return;
      }
      if (statusMsg) statusMsg.innerHTML = `<em>Probando conexión directa con ${provider.toUpperCase()}...</em>`;
      
      const res = await verifyApiKeyConnection(provider, rawKey);
      if (res.ok) {
        if (statusMsg) statusMsg.innerHTML = `<span style="color: #34d399; font-weight: bold;">✓ ¡Conexión exitosa con ${res.providerName}! La clave es 100% válida.</span>`;
        showToast(`✓ Conexión exitosa con ${res.providerName}`);
      } else {
        if (statusMsg) statusMsg.innerHTML = `<span style="color: #fb7185; font-weight: bold;">✕ Rechazada por ${provider.toUpperCase()}: ${res.error}</span>`;
        showToast(`Error de clave: ${res.error}`);
      }
    });
  }

  saveBtn.addEventListener('click', async () => {
    const rawKey = keyInput.value.trim().replace(/^["']|["']$/g, '');
    state.vault.provider = providerSelect.value;
    const ok = await vault.storeKey(rawKey);
    if (ok) {
      keyInput.value = '';
      closeModal();
      showToast(`API Key cifrada en memoria volátil para ${state.vault.provider.toUpperCase()}.`);
    } else {
      showToast('Por favor introduce una API Key válida.');
    }
  });

  purgeBtn.addEventListener('click', () => {
    vault.purge();
    keyInput.value = '';
    closeModal();
    showToast('Credenciales destruidas de la memoria.');
  });
}

// Verificación de conexión en vivo
async function verifyApiKeyConnection(provider, key) {
  try {
    if (provider === 'groq') {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen/qwen3.8-27b',
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 5
        })
      });
      const data = await res.json();
      if (res.ok) return { ok: true, providerName: 'Groq (Qwen 3.8)' };
      return { ok: false, error: data.error?.message || 'Error de autenticación' };
    } else if (provider === 'gemini') {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const data = await res.json();
      if (res.ok) return { ok: true, providerName: 'Google Gemini' };
      return { ok: false, error: data.error?.message || 'Clave no válida en Google AI Studio' };
    } else if (provider === 'nvidia') {
      const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      const data = await res.json();
      if (res.ok) return { ok: true, providerName: 'NVIDIA NIM' };
      return { ok: false, error: data.error?.message || 'Error en NVIDIA NIM' };
    } else if (provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      const data = await res.json();
      if (res.ok && data.data) return { ok: true, providerName: 'OpenRouter' };
      return { ok: false, error: data.error?.message || 'Error en OpenRouter' };
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      const data = await res.json();
      if (res.ok) return { ok: true, providerName: 'OpenAI' };
      return { ok: false, error: data.error?.message || 'Error en OpenAI' };
    }
    return { ok: true, providerName: provider };
  } catch (e) {
    return { ok: false, error: e.message || 'Error de red o conexión' };
  }
}

// ============================================================================
// 12. Asistente de IA (Consultas a LLM Directas desde el Navegador)
// ============================================================================
function setupAiAssistant() {
  const askBtn = document.getElementById('askAiBtn');
  const promptInput = document.getElementById('aiPromptInput');
  const responseBox = document.getElementById('aiResponseBox');

  askBtn.addEventListener('click', async () => {
    const query = promptInput.value.trim();
    if (!query) return;

    if (!state.vault.hasKey) {
      showToast('Abre la Bóveda BYOK y configura tu API Key primero.');
      document.getElementById('vaultModal').style.display = 'flex';
      return;
    }

    const key = await vault.retrieveKey();
    if (!key) {
      showToast('Error al desencriptar la clave en memoria.');
      return;
    }

    responseBox.style.display = 'block';
    responseBox.innerHTML = '<em>Consultando al modelo mediante canal seguro...</em>';

    // Generar resumen del grafo para el contexto
    const topNodes = [...state.graphData.nodes]
      .sort((a, b) => ((b.metadata && b.metadata.total_degree) || 0) - ((a.metadata && a.metadata.total_degree) || 0))
      .slice(0, 10)
      .map(n => `${n.label} (Grado: ${(n.metadata && n.metadata.total_degree) || 0}, PR: ${(n.metadata && n.metadata.pagerank) || 0})`);

    const context = `Grafo activo: "${state.graphData.graph_metadata.title}". Total nodos: ${state.graphData.nodes.length}, Aristas: ${state.graphData.edges.length}. Top 10 nodos por grado: ${topNodes.join(', ')}.`;

    try {
      let answer = '';
      if (state.vault.provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Eres el Recluta 22: ag-graph-visualizer-22, un arquitecto topológico y matemático senior de grafos.\nContexto del grafo:\n${context}\n\nPregunta del usuario:\n${query}`
              }]
            }]
          })
        });
        const jsonRes = await res.json();
        if (jsonRes.candidates && jsonRes.candidates[0].content) {
          answer = jsonRes.candidates[0].content.parts[0].text;
        } else if (jsonRes.error) {
          answer = `Error de API: ${jsonRes.error.message}`;
        }
      } else if (state.vault.provider === 'groq') {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen/qwen3.8-27b',
            messages: [
              { role: 'system', content: `Eres el Recluta 22: ag-graph-visualizer-22. Contexto: ${context}` },
              { role: 'user', content: query }
            ]
          })
        });
        const jsonRes = await res.json();
        answer = jsonRes.choices?.[0]?.message?.content || jsonRes.error?.message || 'Sin respuesta';
      } else if (state.vault.provider === 'nvidia') {
        const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'deepseek-ai/deepseek-v4.1-flash',
            messages: [
              { role: 'system', content: `Eres el Recluta 22: ag-graph-visualizer-22. Contexto: ${context}` },
              { role: 'user', content: query }
            ]
          })
        });
        const jsonRes = await res.json();
        answer = jsonRes.choices?.[0]?.message?.content || jsonRes.error?.message || 'Sin respuesta';
      } else {
        answer = `Proveedor ${state.vault.provider} seleccionado. Contexto transmitido de forma segura.`;
      }

      responseBox.innerHTML = `<strong>Respuesta Topológica:</strong><br>${answer.replace(/\n/g, '<br>')}`;
    } catch (e) {
      responseBox.innerHTML = `<span style="color: var(--accent-rose);">Fallo en la consulta: ${e.message}</span>`;
    }
  });
}

// ============================================================================
// 12.5 Forjador de Grafos con IA (Prompt y Datos a Topología D3)
// ============================================================================
function setupAiForgeModal() {
  const openBtn = document.getElementById('openAiForgeModalBtn');
  const modal = document.getElementById('aiForgeModal');
  const closeBtn = document.getElementById('closeAiForgeBtn');
  const cancelBtn = document.getElementById('cancelAiForgeBtn');
  const submitBtn = document.getElementById('submitAiForgeBtn');
  const titleInput = document.getElementById('aiGraphTitleInput');
  const promptInput = document.getElementById('aiGraphPrompt');
  const paletteSelect = document.getElementById('aiGraphPalette');
  const directionSelect = document.getElementById('aiGraphDirection');
  const loadingIndicator = document.getElementById('aiForgeLoadingIndicator');

  if (!openBtn || !modal) return;

  const openModal = () => {
    modal.style.display = 'flex';
    promptInput.focus();
  };
  const closeModal = () => {
    modal.style.display = 'none';
    loadingIndicator.style.display = 'none';
    submitBtn.disabled = false;
  };

  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  submitBtn.addEventListener('click', async () => {
    const userPrompt = promptInput.value.trim();
    if (!userPrompt) {
      showToast('Por favor describe la red o ingresa los datos a modelar.');
      promptInput.focus();
      return;
    }

    if (!state.vault.hasKey) {
      showToast('Configura tu API Key en la Bóveda Zero-Knowledge primero.');
      closeModal();
      document.getElementById('vaultModal').style.display = 'flex';
      return;
    }

    const key = await vault.retrieveKey();
    if (!key) {
      showToast('Error al desencriptar la clave en memoria.');
      return;
    }

    const title = titleInput.value.trim() || 'Grafo Generado con IA';
    const palette = paletteSelect.value;
    const direction = directionSelect.value;

    loadingIndicator.style.display = 'flex';
    submitBtn.disabled = true;

    try {
      const generatedGraph = await callAiToSynthesizeGraph(key, userPrompt, title, palette, direction);
      if (generatedGraph && generatedGraph.nodes && generatedGraph.nodes.length > 0) {
        // Enriquecer métricas de grado inmediatamente
        computeLocalGraphMetrics(generatedGraph);
        initGraphWithData(generatedGraph);
        closeModal();
        titleInput.value = '';
        promptInput.value = '';
        showToast(`¡Grafo "${title}" forjado exitosamente (${generatedGraph.nodes.length} nodos)!`);
      } else {
        throw new Error('La respuesta de la IA no contiene una lista válida de nodos.');
      }
    } catch (err) {
      console.error('[AI FORGE ERROR]', err);
      alert('Error al forjar el grafo con IA:\n' + err.message);
    } finally {
      loadingIndicator.style.display = 'none';
      submitBtn.disabled = false;
    }
  });
}

async function callAiToSynthesizeGraph(key, userPrompt, title, palette, direction) {
  const paletteInstructions = {
    cyber: 'Colores recomendados: #38bdf8 (cian), #a855f7 (púrpura), #ec4899 (fucsia), #6366f1 (índigo), #f43f5e (carmesí).',
    corporate: 'Colores recomendados: #3b82f6 (azul), #10b981 (esmeralda), #64748b (slate), #0ea5e9 (celeste), #059669 (verde oscuro).',
    sunset: 'Colores recomendados: #f59e0b (ámbar), #f97316 (naranja), #ef4444 (rojo), #ec4899 (rosa), #fbbf24 (dorado).',
    emerald: 'Colores recomendados: #10b981 (esmeralda), #34d399 (menta), #06b6d4 (cian), #059669 (bosque), #6ee7b7 (pastel).'
  };

  const sysPrompt = `Eres el Recluta 22: ag-graph-visualizer-22, especialista en teoría de grafos, análisis de redes complejas y arquitectura topológica.
Tu misión es transformar el texto, descripción o datos del usuario en una red de nodos y aristas rica, semánticamente coherente y matemáticamente balanceada.

REGLAS ESTRICTAS DE RESPUESTA:
1. Tu respuesta DEBE SER EXCLUSIVAMENTE un bloque de código JSON válido, sin texto introductorio ni explicaciones adicionales.
2. Estructura exacta requerida:
{
  "graph_metadata": {
    "title": "${title.replace(/"/g, '\\"')}",
    "directed": ${direction === 'directed'}
  },
  "nodes": [
    {
      "id": "identificador_alfanumerico_sin_espacios",
      "label": "Nombre corto legible",
      "group": "familia_o_cluster",
      "val": 20, // tamaño visual sugerido entre 14 y 30 según relevancia o centralidad
      "color": "#hex", // Usar paleta: ${paletteInstructions[palette] || paletteInstructions.cyber}
      "metadata": {
        "descripcion": "breve detalle o propiedad"
      }
    }
  ],
  "edges": [
    {
      "source": "id_nodo_origen",
      "target": "id_nodo_destino",
      "weight": 2.0, // peso entre 1 y 5
      "label": "verbo_o_relacion",
      "color": "#hex_opcional"
    }
  ]
}
3. Asegúrate de que todos los "source" y "target" de las aristas existan exactamente en la lista de nodos.
4. Diseña una red con mínimo 5 a 30 nodos interconectados según la riqueza de los datos provistos.`;

  let rawJsonText = '';

  if (state.vault.provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
    const payload = {
      contents: [{
        parts: [{
          text: `${sysPrompt}\n\nDATOS O DESCRIPCIÓN DEL USUARIO:\n${userPrompt}`
        }]
      }],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Error en Gemini API');
    rawJsonText = data.candidates[0].content.parts[0].text;
  } else if (state.vault.provider === 'groq') {
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.8-27b',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Error en Groq API');
    rawJsonText = data.choices[0].message.content;
  } else if (state.vault.provider === 'nvidia') {
    const url = 'https://integrate.api.nvidia.com/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'deepseek-ai/deepseek-v4.1-flash',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt }
        ],
        max_tokens: 2048
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Error en NVIDIA NIM');
    rawJsonText = data.choices[0].message.content;
  } else if (state.vault.provider === 'openai') {
    const url = 'https://api.openai.com/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: "json_object" }
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Error en OpenAI API');
    rawJsonText = data.choices[0].message.content;
  } else if (state.vault.provider === 'openrouter') {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model: 'liquid/lfm-3-1.7b:free',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Error en OpenRouter API');
    rawJsonText = data.choices[0].message.content;
  } else {
    throw new Error(`Proveedor "${state.vault.provider}" no soportado directamente para forja asistida.`);
  }

  // Limpiar posibles bloques ```json ... ```
  rawJsonText = rawJsonText.trim();
  if (rawJsonText.startsWith('```json')) {
    rawJsonText = rawJsonText.replace(/^```json\s*/, '').replace(/```\s*$/, '');
  } else if (rawJsonText.startsWith('```')) {
    rawJsonText = rawJsonText.replace(/^```\s*/, '').replace(/```\s*$/, '');
  }

  return JSON.parse(rawJsonText);
}

function computeLocalGraphMetrics(graph) {
  const inDeg = {};
  const outDeg = {};
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];

  nodes.forEach(n => {
    inDeg[n.id] = 0;
    outDeg[n.id] = 0;
    if (!n.metadata) n.metadata = {};
  });

  edges.forEach(e => {
    const s = e.source.id || e.source;
    const t = e.target.id || e.target;
    if (outDeg[s] !== undefined) outDeg[s]++;
    if (inDeg[t] !== undefined) inDeg[t]++;
  });

  const totalN = nodes.length || 1;
  nodes.forEach(n => {
    const i = inDeg[n.id] || 0;
    const o = outDeg[n.id] || 0;
    n.metadata.in_degree = i;
    n.metadata.out_degree = o;
    n.metadata.total_degree = i + o;
    // Aproximación determinista rápida de PageRank local
    n.metadata.pagerank = parseFloat(((1.0 + i * 2) / (totalN + edges.length)).toFixed(4));
  });

  if (!graph.graph_metadata) graph.graph_metadata = {};
  graph.graph_metadata.node_count = nodes.length;
  graph.graph_metadata.edge_count = edges.length;
}

// ============================================================================
// 13. Exportadores de Alta Resolución
// ============================================================================
function exportToSvg() {
  const svgEl = document.getElementById('graphSvg');
  const serializer = new XMLSerializer();
  let source = serializer.serializeToString(svgEl);

  if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, `grafo_${Date.now()}.svg`);
  showToast('Archivo SVG vectorial exportado.');
}

function exportToPng() {
  const svgEl = document.getElementById('graphSvg');
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svgEl);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const scale = 2; // Alta resolución 2x
    canvas.width = svgEl.clientWidth * scale;
    canvas.height = svgEl.clientHeight * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);

    canvas.toBlob((pngBlob) => {
      downloadBlob(pngBlob, `grafo_${Date.now()}.png`);
      showToast('Imagen PNG en alta resolución descargada.');
      URL.revokeObjectURL(url);
    });
  };
  img.src = url;
}

function exportToJson() {
  const str = JSON.stringify(state.graphData, null, 2);
  const blob = new Blob([str], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, `grafo_${Date.now()}.json`);
  showToast('JSON de estructura exportado.');
}

function exportToMarkdown() {
  const d = state.graphData;
  const md = [
    `# 📊 Reporte Topológico: ${d.graph_metadata.title || 'Grafo'}`,
    `- Total Nodos: ${d.nodes.length}`,
    `- Total Aristas: ${d.edges.length}`,
    `- Exportado desde: GraphStudio Enterprise (Recluta 22)`,
    '',
    '## Nodos Principales',
    '| ID | Etiqueta | Grupo | Grado | PageRank |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...d.nodes.map(n => `| ${n.id} | ${n.label} | ${n.group} | ${(n.metadata && n.metadata.total_degree) || '--'} | ${(n.metadata && n.metadata.pagerank) || '--'} |`)
  ].join('\n');

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  downloadBlob(blob, `reporte_grafo_${Date.now()}.md`);
  showToast('Reporte Markdown descargado.');
}

function downloadBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ============================================================================
// 14. Utilidades
// ============================================================================
function getCanvasSize() {
  const container = document.getElementById('canvasContainer');
  return {
    width: container.clientWidth || window.innerWidth || 360,
    height: container.clientHeight || (window.innerHeight - 120) || 500
  };
}

// Redimensionamiento adaptativo en orientación vertical/horizontal de celulares
window.addEventListener('resize', () => {
  const { width, height } = getCanvasSize();
  if (state.simulation && state.activeLayout === 'force') {
    state.simulation.force('center', d3.forceCenter(width / 2, height / 2).strength(state.physics.gravity));
    state.simulation.alpha(0.25).restart();
  }
});

function updateHudStatus(text) {
  document.getElementById('hudStatusMsg').textContent = text;
}

function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ============================================================================
// 14.5 Capas y Navegación Móvil (Bottom Sheet & Bottom Nav)
// ============================================================================
function setupMobileLayers() {
  const backdrop = document.getElementById('drawerBackdrop');
  const tabs = document.querySelectorAll('.mobile-bottom-nav .nav-tab-btn');
  const closeBtns = document.querySelectorAll('.close-drawer-btn');

  const drawers = {
    physics: document.getElementById('sidebarLeft'),
    inspector: document.getElementById('sidebarRight'),
    menu: document.getElementById('mobileMenuDrawer')
  };

  const closeAllDrawers = () => {
    Object.values(drawers).forEach(d => d && d.classList.remove('open'));
    if (backdrop) backdrop.classList.remove('active');
    setMobileTabActive('canvas');
  };

  const openDrawer = (drawerId) => {
    Object.values(drawers).forEach(d => d && d.classList.remove('open'));
    const target = typeof drawerId === 'string' ? document.getElementById(drawerId) : drawerId;
    if (target) {
      target.classList.add('open');
      if (backdrop) backdrop.classList.add('active');
    }
  };

  window.openMobileDrawer = openDrawer;
  window.closeAllMobileDrawers = closeAllDrawers;

  // Tabs de la barra inferior móvil
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabKey = btn.dataset.tab;
      if (tabKey === 'canvas') {
        closeAllDrawers();
      } else if (tabKey === 'physics') {
        openDrawer('sidebarLeft');
        setMobileTabActive('physics');
      } else if (tabKey === 'ai') {
        closeAllDrawers();
        document.getElementById('aiForgeModal').style.display = 'flex';
      } else if (tabKey === 'inspector') {
        openDrawer('sidebarRight');
        setMobileTabActive('inspector');
      } else if (tabKey === 'menu') {
        openDrawer('mobileMenuDrawer');
        setMobileTabActive('menu');
      }
    });
  });

  // Botones de cierre en drawers
  closeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllDrawers();
    });
  });

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeAllDrawers();
    });
  }

  // Buscador móvil flotante
  const mobileSearchBtn = document.getElementById('mobileSearchTriggerBtn');
  const mobileSearchBar = document.getElementById('mobileSearchBar');
  const closeMobileSearchBtn = document.getElementById('closeMobileSearchBtn');
  const mobileSearchInput = document.getElementById('mobileNodeSearchInput');
  const mobileSuggestions = document.getElementById('mobileSearchSuggestions');

  if (mobileSearchBtn && mobileSearchBar) {
    mobileSearchBtn.addEventListener('click', () => {
      const isVisible = mobileSearchBar.style.display === 'flex';
      mobileSearchBar.style.display = isVisible ? 'none' : 'flex';
      if (!isVisible && mobileSearchInput) mobileSearchInput.focus();
    });
    if (closeMobileSearchBtn) {
      closeMobileSearchBtn.addEventListener('click', () => {
        mobileSearchBar.style.display = 'none';
      });
    }
    if (mobileSearchInput && mobileSuggestions) {
      mobileSearchInput.addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (!q) {
          mobileSuggestions.style.display = 'none';
          return;
        }
        const matches = state.graphData.nodes.filter(n => {
          const lbl = (n.label || '').toLowerCase();
          const id = (n.id || '').toLowerCase();
          return lbl.includes(q) || id.includes(q);
        }).slice(0, 6);

        if (matches.length === 0) {
          mobileSuggestions.innerHTML = `<div class="search-item" style="color: var(--text-muted);">Sin coincidencias</div>`;
        } else {
          mobileSuggestions.innerHTML = matches.map(n => `
            <div class="search-item" data-id="${n.id}">
              <span><strong>${n.label}</strong></span>
              <span style="color: ${n.color || 'var(--accent-cyan)'}; font-family: var(--font-mono);">${n.group || ''}</span>
            </div>
          `).join('');
        }
        mobileSuggestions.style.display = 'block';
      });

      mobileSuggestions.addEventListener('click', (e) => {
        const item = e.target.closest('.search-item');
        if (item && item.dataset.id) {
          const node = state.graphData.nodes.find(n => n.id === item.dataset.id);
          if (node) {
            focusOnNode(node);
            onNodeClick(node);
            mobileSuggestions.style.display = 'none';
            mobileSearchBar.style.display = 'none';
          }
        }
      });
    }
  }

  // Acciones en Drawer Menú
  const triggerVault = document.getElementById('mobileTriggerVault');
  if (triggerVault) {
    triggerVault.addEventListener('click', () => {
      closeAllDrawers();
      document.getElementById('vaultModal').style.display = 'flex';
    });
  }

  const triggerAiForge = document.getElementById('mobileTriggerAiForge');
  if (triggerAiForge) {
    triggerAiForge.addEventListener('click', () => {
      closeAllDrawers();
      document.getElementById('aiForgeModal').style.display = 'flex';
    });
  }

  const mobileDataset = document.getElementById('mobileDatasetSelect');
  if (mobileDataset) {
    mobileDataset.addEventListener('change', (e) => {
      if (e.target.value === 'custom') {
        document.getElementById('jsonFileInput').click();
      } else {
        loadDataset(e.target.value);
      }
      closeAllDrawers();
    });
  }

  // Exportadores en móvil
  const mPng = document.getElementById('mobileExportPngBtn');
  if (mPng) mPng.addEventListener('click', () => { exportToPng(); closeAllDrawers(); });
  const mSvg = document.getElementById('mobileExportSvgBtn');
  if (mSvg) mSvg.addEventListener('click', () => { exportToSvg(); closeAllDrawers(); });
  const mJson = document.getElementById('mobileExportJsonBtn');
  if (mJson) mJson.addEventListener('click', () => { exportToJson(); closeAllDrawers(); });
  const mMd = document.getElementById('mobileExportMdBtn');
  if (mMd) mMd.addEventListener('click', () => { exportToMarkdown(); closeAllDrawers(); });
}

function setMobileTabActive(tabKey) {
  document.querySelectorAll('.mobile-bottom-nav .nav-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabKey);
  });
}

// ============================================================================
// 15. Registro de PWA (Service Worker)
// ============================================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=3.0')
      .then((reg) => console.log('[PWA] Service Worker registrado con éxito:', reg.scope))
      .catch((err) => console.warn('[PWA] No se pudo registrar Service Worker:', err));
  });
}
