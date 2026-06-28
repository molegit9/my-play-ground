// API Base URL (relative since frontend is served by FastAPI directly)
const API_BASE = "";

// Global logs state
let currentLogs = [];

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
    checkServerHealth();
    fetchAuditLogs();
    
    // Check health every 15 seconds
    setInterval(checkServerHealth, 15000);
});

// Check FastAPI Server Connection Health
async function checkServerHealth() {
    const statusDot = document.querySelector("#server-status .status-dot");
    const statusText = document.querySelector("#server-status .status-text");
    
    try {
        const res = await fetch(`${API_BASE}/health`);
        if (res.ok) {
            statusDot.className = "status-dot connected pulsing";
            statusText.textContent = "서버 연결됨";
        } else {
            throw new Error("Server error response");
        }
    } catch (e) {
        statusDot.className = "status-dot disconnected pulsing";
        statusText.textContent = "서버 오프라인";
        console.error("Health check failed:", e);
    }
}

// Switch between URL Scan and Text Scan Tabs
window.switchTab = function(tabName) {
    // Buttons
    const urlTabBtn = document.getElementById("tab-url-btn");
    const textTabBtn = document.getElementById("tab-text-btn");
    
    // Content blocks
    const urlTab = document.getElementById("tab-url");
    const textTab = document.getElementById("tab-text");
    
    if (tabName === 'url') {
        urlTabBtn.classList.add("active");
        textTabBtn.classList.remove("active");
        urlTab.classList.add("active");
        textTab.classList.remove("active");
    } else {
        urlTabBtn.classList.remove("active");
        textTabBtn.classList.add("active");
        urlTab.classList.remove("active");
        textTab.classList.add("active");
    }
};

// Clear Textarea form
window.clearTextForm = function() {
    document.getElementById("scan-text-input").value = "";
    document.getElementById("text-console").classList.add("hidden");
    document.getElementById("text-result").classList.add("hidden");
};

// Turn all active spin icons in this console into checkmarks when a step is completed
function markPreviousSpinLogsAsDone(consoleId) {
    const logsContainer = document.getElementById(`${consoleId}-logs`);
    if (!logsContainer) return;
    const spinIcons = logsContainer.querySelectorAll(".log-icon-spin");
    spinIcons.forEach(icon => {
        icon.className = "fa-solid fa-circle-check log-icon-check";
    });
}

// Append a log item to the console logger
function appendConsoleLog(consoleId, text, iconType = "spin") {
    const logsContainer = document.getElementById(`${consoleId}-logs`);
    const logItem = document.createElement("div");
    logItem.className = "log-item";
    
    let iconHTML = "";
    if (iconType === "spin") {
        iconHTML = `<i class="fa-solid fa-circle-notch log-icon-spin"></i>`;
    } else if (iconType === "check") {
        iconHTML = `<i class="fa-solid fa-circle-check log-icon-check"></i>`;
    } else if (iconType === "alert") {
        iconHTML = `<i class="fa-solid fa-triangle-exclamation log-icon-alert"></i>`;
    } else if (iconType === "info") {
        iconHTML = `<i class="fa-solid fa-circle-info text-info"></i>`;
    }
    
    logItem.innerHTML = `${iconHTML} <span>${text}</span>`;
    logsContainer.appendChild(logItem);
    
    // Auto scroll to bottom
    logsContainer.scrollTop = logsContainer.scrollHeight;
}

// Start URL Scanning Process (Streaming)
window.startUrlScan = async function() {
    const urlInput = document.getElementById("scan-url-input").value.trim();
    const deepScan = document.getElementById("deep-scan-checkbox").checked;
    
    const consoleBox = document.getElementById("url-console");
    const logsContainer = document.getElementById("url-logs");
    const loader = document.getElementById("url-loader");
    const resultBox = document.getElementById("url-result");
    
    // Reset views
    consoleBox.classList.remove("hidden");
    logsContainer.innerHTML = "";
    resultBox.classList.add("hidden");
    loader.classList.remove("hidden");
    
    appendConsoleLog("url", "URL 분석 준비 중...", "spin");
    
    try {
        const response = await fetch(`${API_BASE}/api/web/scan/url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: urlInput, enable_deep_scan: deepScan })
        });
        
        if (!response.ok) {
            throw new Error(`서버 응답 오류 (코드: ${response.status})`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        
        appendConsoleLog("url", "파이프라인 스트림 연결 완료", "check");
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop(); // save incomplete line
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const chunk = JSON.parse(line);
                    
                    if (chunk.progress) {
                        // Progress update
                        markPreviousSpinLogsAsDone("url");
                        const isWarning = chunk.progress.includes("⚠️") || chunk.progress.includes("오류");
                        appendConsoleLog("url", chunk.progress, isWarning ? "alert" : "spin");
                    } else if (chunk.status === "success") {
                        // Success final block
                        markPreviousSpinLogsAsDone("url");
                        const data = JSON.parse(chunk.data);
                        displayUrlResult(data);
                    } else if (chunk.status === "error" || chunk.message) {
                        markPreviousSpinLogsAsDone("url");
                        appendConsoleLog("url", `검사 중 에러: ${chunk.message || chunk.detail}`, "alert");
                    }
                } catch (e) {
                    console.error("Chunk parsing error:", e, line);
                }
            }
        }
    } catch (e) {
        markPreviousSpinLogsAsDone("url");
        appendConsoleLog("url", `통신 장애: ${e.message}`, "alert");
        console.error(e);
    } finally {
        loader.classList.add("hidden");
        // Update audit logs to capture the new scan
        setTimeout(fetchAuditLogs, 1000);
    }
};

// Render final URL scan outcome
function displayUrlResult(result) {
    const resultBox = document.getElementById("url-result");
    const gaugeScore = document.getElementById("url-safety-score");
    const safetyBadge = document.getElementById("url-safety-badge");
    const safetyReason = document.getElementById("url-safety-reason");
    const gaugeRing = document.getElementById("url-gauge-ring");
    
    resultBox.classList.remove("hidden");
    
    const score = result.safety_score;
    gaugeScore.textContent = score;
    safetyReason.innerHTML = result.reason;
    
    // Dynamic styles based on safety level
    let badgeClass = "badge ";
    let ringColor = "";
    
    if (score >= 70) {
        badgeClass += "safe";
        ringColor = "#10B981"; // Safe green
        safetyBadge.textContent = "안전함 (SAFE)";
        appendConsoleLog("url", "종합 보안 진단: 안전 도메인", "check");
    } else if (score >= 40) {
        badgeClass += "warning";
        ringColor = "#F59E0B"; // Warning orange
        safetyBadge.textContent = "의심됨 (WARNING)";
        appendConsoleLog("url", "종합 보안 진단: 사칭/조작 의심 소지 있음!!", "alert");
    } else {
        badgeClass += "danger";
        ringColor = "#EF4444"; // Danger red
        safetyBadge.textContent = "위험함 (DANGER)";
        appendConsoleLog("url", "종합 보안 진단: 악성 피싱/사기 사이트 확정!!!", "alert");
    }
    
    safetyBadge.className = badgeClass;
    gaugeRing.style.background = `conic-gradient(${ringColor} 0% ${score}%, rgba(255,255,255,0.05) ${score}% 100%)`;
    gaugeRing.style.boxShadow = `0 0 20px ${ringColor}33`;
    
    // Smooth scroll into result
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Start Text (Smishing) Analysis Process (Streaming)
window.startTextScan = async function() {
    const textInput = document.getElementById("scan-text-input").value.trim();
    
    const consoleBox = document.getElementById("text-console");
    const logsContainer = document.getElementById("text-logs");
    const loader = document.getElementById("text-loader");
    const resultBox = document.getElementById("text-result");
    
    // Reset views
    consoleBox.classList.remove("hidden");
    logsContainer.innerHTML = "";
    resultBox.classList.add("hidden");
    loader.classList.remove("hidden");
    
    appendConsoleLog("text", "텍스트 형태소 및 사기 패턴 분석 시작...", "spin");
    
    try {
        const response = await fetch(`${API_BASE}/api/web/scan/text`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: textInput })
        });
        
        if (!response.ok) {
            throw new Error(`서버 응답 오류 (코드: ${response.status})`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        
        appendConsoleLog("text", "AI RAG 데이터베이스 매핑 완료", "check");
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop(); // save incomplete line
            
            for (const line of lines) {
                if (!line.trim()) continue;
                
                try {
                    const chunk = JSON.parse(line);
                    
                    if (chunk.progress) {
                        markPreviousSpinLogsAsDone("text");
                        appendConsoleLog("text", chunk.progress, "spin");
                    } else if (chunk.risk_level) {
                        // Final result containing RAG & AI feedback
                        markPreviousSpinLogsAsDone("text");
                        displayTextResult(chunk);
                    } else if (chunk.message || chunk.detail) {
                        markPreviousSpinLogsAsDone("text");
                        appendConsoleLog("text", `에러: ${chunk.message || chunk.detail}`, "alert");
                    }
                } catch (e) {
                    console.error("Chunk parse error:", e, line);
                }
            }
        }
    } catch (e) {
        markPreviousSpinLogsAsDone("text");
        appendConsoleLog("text", `통신 장애: ${e.message}`, "alert");
        console.error(e);
    } finally {
        loader.classList.add("hidden");
        // Update audit logs
        setTimeout(fetchAuditLogs, 1000);
    }
};

// Render final Text scan outcome
function displayTextResult(result) {
    const resultBox = document.getElementById("text-result");
    const riskBadge = document.getElementById("text-risk-badge");
    const riskScore = document.getElementById("text-risk-score");
    const riskReason = document.getElementById("text-risk-reason");
    const riskMitigation = document.getElementById("text-risk-mitigation");
    
    resultBox.classList.remove("hidden");
    
    const score = result.score; // 0 to 100 (high is risky)
    riskScore.textContent = score;
    riskReason.innerHTML = result.reason;
    riskMitigation.textContent = result.mitigation || "의심되는 첨부링크 및 전화번호는 일체 확인하지 말고 즉시 메시지를 완전히 지우십시오.";
    
    // Dynamic styling
    let badgeClass = "badge ";
    const highlightBox = document.querySelector(".result-section.highlight");
    
    if (score >= 70) {
        badgeClass += "danger";
        riskBadge.textContent = `${result.risk_level} (HIGH RISK)`;
        highlightBox.classList.add("danger-active");
        appendConsoleLog("text", "사회공학 분석 완료: 심각한 위협 패턴 검출됨", "alert");
    } else if (score >= 40) {
        badgeClass += "warning";
        riskBadge.textContent = `${result.risk_level} (MODERATE)`;
        highlightBox.classList.remove("danger-active");
        appendConsoleLog("text", "사회공학 분석 완료: 주의 수준의 패턴 유도", "alert");
    } else {
        badgeClass += "safe";
        riskBadge.textContent = `${result.risk_level} (SAFE/CLEAN)`;
        highlightBox.classList.remove("danger-active");
        appendConsoleLog("text", "사회공학 분석 완료: 위협 패턴 탐지 안 됨", "check");
    }
    
    riskBadge.className = badgeClass;
    
    // Smooth scroll into result
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// Fetch security logs history
window.fetchAuditLogs = async function() {
    const refreshBtn = document.getElementById("refresh-logs-btn");
    if (refreshBtn) {
        refreshBtn.querySelector("i").classList.add("fa-spin");
    }
    
    try {
        const res = await fetch(`${API_BASE}/api/web/logs?limit=25`);
        if (!res.ok) throw new Error("Could not fetch security logs");
        
        const data = await res.json();
        if (data.status === "success" && Array.isArray(data.logs)) {
            currentLogs = data.logs;
            renderAuditLogs(data.logs);
            updateStatistics(data.logs);
        }
    } catch (e) {
        console.error("Failed to load logs:", e);
    } finally {
        if (refreshBtn) {
            setTimeout(() => {
                refreshBtn.querySelector("i").classList.remove("fa-spin");
            }, 600);
        }
    }
};

// Render database logs inside table
function renderAuditLogs(logs) {
    const tbody = document.getElementById("audit-log-tbody");
    tbody.innerHTML = "";
    
    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">보안 검사 기록이 없습니다.</td></tr>`;
        return;
    }
    
    logs.forEach((log) => {
        const tr = document.createElement("tr");
        
        // Time format
        const logDate = new Date(log.timestamp);
        const timeStr = isNaN(logDate.getTime()) 
            ? log.timestamp 
            : `${logDate.getMonth() + 1}/${logDate.getDate()} ${logDate.getHours().toString().padStart(2, '0')}:${logDate.getMinutes().toString().padStart(2, '0')}`;
            
        // Type Display
        let typeBadgeHTML = "";
        let targetText = "";
        let resultBadgeHTML = "";
        
        if (log.type === "email") {
            typeBadgeHTML = `<span class="badge" style="background-color:rgba(168,85,247,0.1); color:#A855F7; border:1px solid rgba(168,85,247,0.2)">이메일 RAG</span>`;
            targetText = log.subject || log.sender || "Unknown Message";
            const level = log.risk_level || (log.is_phishing ? "위험" : "안전");
            const isPhish = log.is_phishing || level.includes("위험") || level.includes("피싱");
            resultBadgeHTML = isPhish 
                ? `<span class="badge danger">피싱 메일</span>`
                : `<span class="badge safe">안전 메일</span>`;
        } else if (log.type === "url") {
            const isTextScan = log.action_type === "web_text";
            typeBadgeHTML = isTextScan 
                ? `<span class="badge" style="background-color:rgba(6,182,212,0.1); color:#06B6D4; border:1px solid rgba(6,182,212,0.2)">텍스트 피싱</span>`
                : `<span class="badge" style="background-color:rgba(59,130,246,0.1); color:#3B82F6; border:1px solid rgba(59,130,246,0.2)">URL 검사</span>`;
                
            targetText = log.content || "";
            
            // Safety Score is stored in status
            const safetyScore = parseInt(log.status);
            if (!isNaN(safetyScore)) {
                if (safetyScore >= 70) {
                    resultBadgeHTML = `<span class="badge safe">${safetyScore}점 (안전)</span>`;
                } else if (safetyScore >= 40) {
                    resultBadgeHTML = `<span class="badge warning">${safetyScore}점 (경고)</span>`;
                } else {
                    resultBadgeHTML = `<span class="badge danger">${safetyScore}점 (위험)</span>`;
                }
            } else {
                resultBadgeHTML = `<span class="badge warning">평가 지연</span>`;
            }
        }
        
        tr.innerHTML = `
            <td>${timeStr}</td>
            <td>${typeBadgeHTML}</td>
            <td><span class="target-text-cell" title="${escapeHtml(targetText)}">${escapeHtml(targetText)}</span></td>
            <td>${resultBadgeHTML}</td>
            <td><button class="btn-view" onclick="showLogDetails(${log.id}, '${log.type}')">상세</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// Compute statistics dashboard
function updateStatistics(logs) {
    const totalCountEl = document.getElementById("stats-total-count");
    const safeRatioEl = document.getElementById("stats-safe-ratio");
    
    const total = logs.length;
    totalCountEl.textContent = total;
    
    if (total === 0) {
        safeRatioEl.textContent = "0%";
        return;
    }
    
    let safeCount = 0;
    logs.forEach(log => {
        if (log.type === "email") {
            if (!log.is_phishing && !String(log.risk_level).includes("위험")) {
                safeCount++;
            }
        } else if (log.type === "url") {
            const score = parseInt(log.status);
            if (!isNaN(score) && score >= 70) {
                safeCount++;
            }
        }
    });
    
    const ratio = Math.round((safeCount / total) * 100);
    safeRatioEl.textContent = `${ratio}%`;
}

// Open modal containing audit log diagnostic details
window.showLogDetails = function(id, type) {
    const log = currentLogs.find(l => l.id === id && l.type === type);
    if (!log) return;
    
    const modal = document.getElementById("log-detail-modal");
    const timeEl = document.getElementById("modal-time");
    const typeEl = document.getElementById("modal-type");
    const targetEl = document.getElementById("modal-target");
    const scoreEl = document.getElementById("modal-score");
    const reasonEl = document.getElementById("modal-reason");
    
    // Time
    const d = new Date(log.timestamp);
    timeEl.textContent = isNaN(d.getTime()) ? log.timestamp : d.toLocaleString();
    
    // Type and Details
    if (log.type === "email") {
        typeEl.textContent = "사회공학 이메일 분석";
        targetEl.textContent = `보낸이: ${log.sender || '-'}\n제목: ${log.subject || '-'}\nMessage ID: ${log.message_id || '-'}`;
        
        const isPhish = log.is_phishing || String(log.risk_level).includes("위험");
        scoreEl.innerHTML = isPhish 
            ? `<span class="badge danger" style="padding: 0.2rem 0.6rem">피싱 의심 확정</span>`
            : `<span class="badge safe" style="padding: 0.2rem 0.6rem">일반 안전 메일</span>`;
            
        reasonEl.innerHTML = log.summary || "상세 설명이 존재하지 않습니다.";
    } else {
        const isText = log.action_type === "web_text";
        typeEl.textContent = isText ? "텍스트 사회공학 피싱 검사" : "웹 URL 가상 브라우저 정밀 검사";
        targetEl.textContent = log.content || "-";
        
        const score = parseInt(log.status);
        if (!isNaN(score)) {
            let label = score >= 70 ? "안전" : (score >= 40 ? "경고" : "위험");
            let cls = score >= 70 ? "safe" : (score >= 40 ? "warning" : "danger");
            scoreEl.innerHTML = `안전도 점수: <strong>${score}/100</strong> <span class="badge ${cls}" style="padding: 0.2rem 0.6rem; margin-left: 0.5rem;">${label}</span>`;
        } else {
            scoreEl.textContent = "판정 보류";
        }
        
        reasonEl.innerHTML = log.reason || "판정 근거에 대한 설명이 기록되지 않았습니다.";
    }
    
    modal.classList.add("show");
};

// Close modal
window.closeModal = function() {
    document.getElementById("log-detail-modal").classList.remove("show");
};

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById("log-detail-modal");
    if (event.target === modal) {
        closeModal();
    }
};

// Escape HTML utility
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
