// Configuration
const API_BASE_URL = "http://154.30.6.71:8080"; // Replace with your actual API domain
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

    // Load detailed college data
    await loadCollegeDetails(collegesListData.data.colleges);

    hideLoading();
    showMainContent();
  } catch (error) {
    console.error("Error loading data:", error);
    showError(error.message);
  }
}

// Load detailed data for all colleges
async function loadCollegeDetails(colleges) {
  const collegePromises = colleges.map(async (college) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/college/${college.code}`
      );
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          return {
            ...college,
            ...data.data.college_info,
            majors: data.data.majors,
          };
        }
      }
    } catch (error) {
      console.error(`Error loading data for college ${college.code}:`, error);
    }

    // Return basic college info if detailed data fails
    return {
      ...college,
      total_majors: 0,
      total_applicants: 0,
      majors: [],
    };
  });

  collegesData = await Promise.all(collegePromises);
  renderColleges();
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
    const updateTime = new Date(data.last_updated);
    lastUpdatedElement.textContent = `最后更新: ${updateTime.toLocaleString(
      "zh-CN"
    )}`;
  }
}

// Render colleges grid
function renderColleges() {
  const grid = document.getElementById("colleges-grid");
  grid.innerHTML = "";

  collegesData.forEach((college) => {
    const card = createCollegeCard(college);
    grid.appendChild(card);
  });
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
    college.majors.forEach((major) => {
      const row = document.createElement("tr");
      row.innerHTML = `
                <td>${major.major_name}</td>
                <td>${major.applicant_count.toLocaleString()}</td>
                <td>${major.remaining_quota || "-"}</td>
                <td class="${
                  major.is_available === "是" ? "available-yes" : "available-no"
                }">
                    ${major.is_available}
                </td>
            `;
      tbody.appendChild(row);
    });
  } else {
    const row = document.createElement("tr");
    row.innerHTML = '<td colspan="4" class="text-center">暂无专业数据</td>';
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
