// Configuration
const API_BASE_URL = "https://api.ignilumen.de:8443"; // Replace with your actual API domain
let collegesData = [];
let statisticsData = null;

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  loadData();
});

// Load all data
async function loadData() {
  try {
    showLoading();

    // Load statistics and colleges data
    const [statsResponse, collegesResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/api/statistics`),
      fetch(`${API_BASE_URL}/api/colleges`),
    ]);

    if (!statsResponse.ok || !collegesResponse.ok) {
      throw new Error("Failed to fetch data from API");
    }

    const statsData = await statsResponse.json();
    const collegesListData = await collegesResponse.json();

    if (!statsData.success || !collegesListData.success) {
      throw new Error(
        statsData.message || collegesListData.message || "API returned error"
      );
    }

    statisticsData = statsData;

    // Update UI with statistics
    updateStatistics(statsData);
    updateDataStatus(statsData);

    // Load detailed college + majors data via single endpoint
    await loadAllCollegesAndMajors();

    hideLoading();
    showMainContent();
  } catch (error) {
    console.error("Error loading data:", error);
    showError(error.message);
  }
}

// Load all colleges and majors via single endpoint
async function loadAllCollegesAndMajors() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/all-colleges`);
    if (!res.ok) throw new Error("Failed to fetch all colleges");
    const payload = await res.json();
    if (!payload.success)
      throw new Error(payload.message || "API returned error");

    // Expect payload.data.colleges: [{ code, name, college_name, total_majors, total_applicants, majors: [...] }]
    collegesData = payload.data.colleges || [];
    renderColleges();
    buildMajorsFlatList();
  } catch (err) {
    console.error("Error loading all colleges:", err);
  }
}

// Update statistics display
function updateStatistics(data) {
  const summary = data.data.summary;

  document.getElementById("total-colleges").textContent =
    summary.total_colleges.toLocaleString();
  document.getElementById("total-majors").textContent =
    summary.total_majors.toLocaleString();
  document.getElementById("total-applicants").textContent =
    summary.total_applicants.toLocaleString();
  document.getElementById("avg-applicants").textContent =
    summary.avg_applicants_per_major.toFixed(1);
}

// Update data status indicator
function updateDataStatus(data) {
  const statusElement = document.getElementById("status-indicator");
  const lastUpdatedElement = document.getElementById("last-updated");

  if (data.data_freshness === "fresh") {
    statusElement.textContent = "🟢 数据新鲜";
    statusElement.className = "status-fresh";
  } else {
    statusElement.textContent = "🟡 数据可能过时";
    statusElement.className = "status-stale";
  }

  if (data.last_updated) {
    lastUpdatedElement.textContent = `最后更新: ${data.last_updated}`;
  }
}

// Render colleges grid
function renderColleges() {
  const grid = document.getElementById("colleges-grid");
  grid.innerHTML = "";

  // Render in chunks for performance
  const CHUNK = 24;
  let offset = 0;
  (function renderBatch() {
    const slice = collegesData.slice(offset, offset + CHUNK);
    slice.forEach((college) => {
      const card = createCollegeCard(college);
      grid.appendChild(card);
    });
    offset += CHUNK;
    if (offset < collegesData.length) {
      requestIdleCallback(renderBatch, { timeout: 200 });
    }
  })();
}

// Create college card element
function createCollegeCard(college) {
  const card = document.createElement("div");
  card.className = "college-card";
  card.onclick = () => showCollegeDetail(college);

  card.innerHTML = `
        <div class="college-name">${college.college_name || college.name}</div>
        <div class="college-code">代码: ${
          college.college_code || college.code
        }</div>
        <div class="college-stats">
            <div class="stat-item">
                <span class="stat-label">专业数</span>
                <div class="stat-value">${college.total_majors || 0}</div>
            </div>
            <div class="stat-item">
                <span class="stat-label">申请人数</span>
                <div class="stat-value">${(
                  college.total_applicants || 0
                ).toLocaleString()}</div>
            </div>
            <div class="stat-item">
                <span class="stat-label">平均申请</span>
                <div class="stat-value">${
                  college.total_majors > 0
                    ? (
                        (college.total_applicants || 0) / college.total_majors
                      ).toFixed(1)
                    : "0"
                }</div>
            </div>
        </div>
    `;

  return card;
}

// Show college detail modal
function showCollegeDetail(college) {
  document.getElementById("modal-college-name").textContent =
    college.college_name || college.name;
  document.getElementById("modal-college-code").textContent =
    college.college_code || college.code;
  document.getElementById("modal-total-majors").textContent =
    college.total_majors || 0;
  document.getElementById("modal-total-applicants").textContent = (
    college.total_applicants || 0
  ).toLocaleString();

  // Populate majors table
  const tbody = document.getElementById("majors-table-body");
  tbody.innerHTML = "";

  if (college.majors && college.majors.length > 0) {
    const majorsLoading = document.getElementById("majors-loading");
    if (majorsLoading) majorsLoading.classList.remove("hidden");
    // Render in chunks for performance
    const CHUNK = 30;
    (function renderBatch(offset = 0) {
      const slice = college.majors.slice(offset, offset + CHUNK);
      const frag = document.createDocumentFragment();
      slice.forEach((major) => {
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${major.major_name}</td>
          <td>${major.applicant_count.toLocaleString()}</td>
          <td>${major.remaining_quota || "-"}</td>
        `;
        frag.appendChild(row);
      });
      tbody.appendChild(frag);
      if (offset + CHUNK < college.majors.length) {
        requestIdleCallback(() => renderBatch(offset + CHUNK), {
          timeout: 200,
        });
      } else if (majorsLoading) {
        majorsLoading.classList.add("hidden");
      }
    })();
  } else {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="3" class="text-center">暂无专业数据</td>';
    tbody.appendChild(row);
  }

  document.getElementById("college-modal").style.display = "block";
}

// Close modal
function closeModal() {
  document.getElementById("college-modal").style.display = "none";
}

// Filter colleges by search term
function filterColleges() {
  const searchTerm = document
    .getElementById("college-search")
    .value.toLowerCase();
  const cards = document.querySelectorAll(".college-card");

  cards.forEach((card) => {
    const collegeName = card
      .querySelector(".college-name")
      .textContent.toLowerCase();
    if (collegeName.includes(searchTerm)) {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });
}

// Sort colleges
function sortColleges() {
  if (document.getElementById("colleges-grid").classList.contains("hidden"))
    return;
  const sortBy = document.getElementById("sort-select").value;

  collegesData.sort((a, b) => {
    switch (sortBy) {
      case "applicants-desc":
        return (b.total_applicants || 0) - (a.total_applicants || 0);
      case "applicants-asc":
        return (a.total_applicants || 0) - (b.total_applicants || 0);
      case "name-asc":
        return (a.college_name || a.name).localeCompare(
          b.college_name || b.name
        );
      case "majors-desc":
        return (b.total_majors || 0) - (a.total_majors || 0);
      default:
        return 0;
    }
  });

  renderColleges();
}

// Major list view helpers
let majorsFlat = [];
let majorsSortBy = "applicants-desc";

function buildMajorsFlatList() {
  majorsFlat = [];
  let idx = 0;
  collegesData.forEach((col) => {
    (col.majors || []).forEach((m) => {
      majorsFlat.push({
        major_name: m.major_name,
        college_name: col.college_name || col.name,
        applicant_count: m.applicant_count ?? 0,
        remaining_quota: m.remaining_quota ?? null,
        idx: idx++,
      });
    });
  });
  renderMajorsList();
}

function switchView(view) {
  const btnColleges = document.getElementById("view-colleges");
  const btnMajors = document.getElementById("view-majors");
  const collegesGrid = document.getElementById("colleges-grid");
  const majorsView = document.getElementById("majors-list-view");
  const collegesSearch = document.getElementById("colleges-search");

  if (view === "majors") {
    btnColleges.classList.remove("active");
    btnMajors.classList.add("active");
    collegesGrid.classList.add("hidden");
    collegesSearch.classList.add("hidden");
    majorsView.classList.remove("hidden");
    renderMajorsList();
  } else {
    btnMajors.classList.remove("active");
    btnColleges.classList.add("active");
    majorsView.classList.add("hidden");
    collegesGrid.classList.remove("hidden");
    collegesSearch.classList.remove("hidden");
  }
}

function sortMajorsList() {
  majorsSortBy = document.getElementById("major-sort-select").value;
  renderMajorsList();
}

function renderMajorsList() {
  const tbody = document.getElementById("majors-list-body");
  const loading = document.getElementById("majors-list-loading");
  if (loading) loading.classList.remove("hidden");
  tbody.innerHTML = "";

  const copy = majorsFlat.slice();
  if (majorsSortBy === "applicants-desc") {
    copy.sort((a, b) => (b.applicant_count || 0) - (a.applicant_count || 0));
  } else if (majorsSortBy === "ratio-desc") {
    // Stable, cross-browser sort with explicit numeric coercion and category ranking
    copy.sort((a, b) => {
      const ra = ratioRank(a);
      const rb = ratioRank(b);
      if (ra.cat !== rb.cat) return ra.cat - rb.cat; // lower cat first: 0 (inf) -> 1 (finite) -> 2 (0/0)
      if (ra.cat === 1) {
        if (rb.ratio !== ra.ratio) return rb.ratio - ra.ratio; // desc by finite ratio
      }
      // tie-breakers for cat 0, 1, 2 to ensure stable, deterministic order
      const aApp = toNum(a.applicant_count);
      const bApp = toNum(b.applicant_count);
      if (bApp !== aApp) return bApp - aApp; // higher applicants first
      return (a.idx ?? 0) - (b.idx ?? 0); // preserve original order
    });
  }

  const CHUNK = 50;

  let offset = 0;
  (function renderBatch() {
    const slice = copy.slice(offset, offset + CHUNK);
    const frag = document.createDocumentFragment();
    slice.forEach((item) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${item.major_name}</td>
        <td>${item.college_name || "-"}</td>
        <td>${(item.applicant_count || 0).toLocaleString()}</td>
        <td>${item.remaining_quota ?? "-"}</td>
      `;
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
    offset += CHUNK;
    if (offset < copy.length) {
      requestIdleCallback(renderBatch, { timeout: 200 });
    } else if (loading) {
      loading.classList.add("hidden");
    }
  })();
}

// UI state management
function showLoading() {
  document.getElementById("loading").style.display = "block";
  document.getElementById("error-message").style.display = "none";
  document.getElementById("main-content").style.display = "none";
}

function showError(message) {
  document.getElementById("loading").style.display = "none";
  document.getElementById("error-message").style.display = "block";
  document.getElementById("main-content").style.display = "none";
  document.getElementById("error-text").textContent = message;
}

function showMainContent() {
  document.getElementById("loading").style.display = "none";
  document.getElementById("error-message").style.display = "none";
  document.getElementById("main-content").style.display = "block";
}

function hideLoading() {
  document.getElementById("loading").style.display = "none";
}

// Retry loading data
function retryLoad() {
  loadData();
}

// Close modal when clicking outside
window.onclick = function (event) {
  const modal = document.getElementById("college-modal");
  if (event.target === modal) {
    closeModal();
  }
};

// Handle escape key to close modal
document.addEventListener("keydown", function (event) {
  if (event.key === "Escape") {
    closeModal();
  }
});

// ---------- Excel Export ----------
function exportCollegesToExcel() {
  try {
    if (!window.ExcelJS) return alert("Excel 导出库未加载，请稍后重试");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Colleges");

    // headers
    sheet.columns = [
      { header: "学院名称", key: "college_name", width: 24 },
      { header: "学院代码", key: "college_code", width: 14 },
      { header: "专业总数", key: "total_majors", width: 12 },
      { header: "申请总人数", key: "total_applicants", width: 14 },
      { header: "平均申请", key: "avg_applicants", width: 12 },
    ];

    // Use current on-screen order: collegesData after sortColleges()
    (collegesData || []).forEach((c) => {
      const avg =
        c.total_majors > 0 ? (c.total_applicants || 0) / c.total_majors : 0;
      sheet.addRow({
        college_name: c.college_name || c.name,
        college_code: c.college_code || c.code || "",
        total_majors: c.total_majors || 0,
        total_applicants: c.total_applicants || 0,
        avg_applicants: Number(avg.toFixed(2)),
      });
    });

    sheet.getRow(1).font = { bold: true };

    workbook.xlsx.writeBuffer().then((buffer) => {
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `学院视图_${formatNow()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  } catch (e) {
    console.error(e);
    alert("导出失败，请重试");
  }
}

function exportMajorsToExcel() {
  try {
    if (!window.ExcelJS) return alert("Excel 导出库未加载，请稍后重试");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Majors");

    sheet.columns = [
      { header: "专业名称", key: "major_name", width: 24 },
      { header: "学院名称", key: "college_name", width: 24 },
      { header: "申请人数", key: "applicant_count", width: 12 },
      { header: "余量", key: "remaining_quota", width: 10 },
      { header: "申请/余量比", key: "ratio", width: 12 },
    ];

    // Build a copy in the exact current order in the UI
    const data = buildCurrentMajorsOrder();

    data.forEach((row) => {
      const excelRow = sheet.addRow(row);
      // Apply gradient coloring if current sort is by ratio-desc
      if (majorsSortBy === "ratio-desc") {
        // Map rank to a color gradient (red -> orange -> yellow -> green)
        const color = rankToColor(row.__rankIndex, data.length);
        // Color the entire row lightly
        excelRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: color },
          };
        });
      }
    });

    sheet.getRow(1).font = { bold: true };

    workbook.xlsx.writeBuffer().then((buffer) => {
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `专业列表_${formatNow()}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    });
  } catch (e) {
    console.error(e);
    alert("导出失败，请重试");
  }
}

function buildCurrentMajorsOrder() {
  // Recreate the exact order currently shown
  let arr = majorsFlat.slice();
  if (majorsSortBy === "applicants-desc") {
    arr.sort((a, b) => (b.applicant_count || 0) - (a.applicant_count || 0));
  } else if (majorsSortBy === "ratio-desc") {
    arr.sort((a, b) => {
      const ra = ratioRank(a);
      const rb = ratioRank(b);
      if (ra.cat !== rb.cat) return ra.cat - rb.cat;
      if (ra.cat === 1 && rb.ratio !== ra.ratio) return rb.ratio - ra.ratio;
      const aApp = toNum(a.applicant_count),
        bApp = toNum(b.applicant_count);
      if (bApp !== aApp) return bApp - aApp;
      return (a.idx ?? 0) - (b.idx ?? 0);
    });
  }

  // Add calculated ratio and stable rank index for coloring
  const result = arr.map((m, i) => ({
    major_name: m.major_name,
    college_name: m.college_name,
    applicant_count: m.applicant_count || 0,
    remaining_quota: m.remaining_quota ?? null,
    ratio: computeRatioForExport(m),
    __rankIndex: i,
  }));
  return result;
}

function computeRatioForExport(item) {
  const a = toNum(item.applicant_count);
  const q = toNum(item.remaining_quota);
  if (q <= 0) return a === 0 ? 0 : Infinity;
  return Number((a / q).toFixed(4));
}

function rankToColor(index, total) {
  if (total <= 1) return "FFFFFFFF"; // white
  // Normalize rank: 0 is top -> red, total-1 is bottom -> green
  const t = index / (total - 1);
  // Gradient stops: red (#FF3B30) -> orange (#FF9F0A) -> yellow (#FFD60A) -> green (#34C759)
  const stops = [
    { r: 0xff, g: 0x3b, b: 0x30 },
    { r: 0xff, g: 0x9f, b: 0x0a },
    { r: 0xff, g: 0xd6, b: 0x0a },
    { r: 0x34, g: 0xc7, b: 0x59 },
  ];
  // Choose segment
  const seg = Math.min(2, Math.floor(t * 3));
  const t2 = (t - seg / 3) * 3;
  const c0 = stops[seg];
  const c1 = stops[seg + 1];
  const r = Math.round(c0.r + (c1.r - c0.r) * t2);
  const g = Math.round(c0.g + (c1.g - c0.g) * t2);
  const b = Math.round(c0.b + (c1.b - c0.b) * t2);
  // Return ARGB
  const toHex = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  return `FF${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function formatNow() {
  const d = new Date();
  const s = d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return s.replace(/[\\/:\s]/g, "-");
}
