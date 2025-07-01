
// Global variables
let currentConnection = null;
let currentPath = '';
let pathHistory = [''];
let commandHistory = [];
let commandHistoryIndex = -1;
let isExecuting = false;
let autoRefreshInterval = null;

// Utility functions
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// Toast notifications
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const iconMap = {
        success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20,6 9,17 4,12"/></svg>',
        error: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    };
    
    toast.innerHTML = `
        <div class="toast-icon ${type}">${iconMap[type]}</div>
        <div class="toast-message">${message}</div>
        <button class="toast-close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;
    
    container.appendChild(toast);
    
    // Auto-remove after 4 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 4000);
    
    // Close button
    toast.querySelector('.toast-close').onclick = () => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    };
}

// Local storage utilities
const storage = {
    saveConnection: (connection) => {
        const connections = storage.getConnections();
        const existing = connections.findIndex(c => c.ip === connection.ip);
        
        if (existing >= 0) {
            connections[existing] = { ...connection, lastConnected: new Date().toISOString() };
        } else {
            connections.push({ ...connection, lastConnected: new Date().toISOString() });
        }
        
        localStorage.setItem('pc_connections', JSON.stringify(connections));
    },

    getConnections: () => {
        const stored = localStorage.getItem('pc_connections');
        return stored ? JSON.parse(stored) : [];
    },

    setCurrentConnection: (connection) => {
        localStorage.setItem('current_connection', JSON.stringify(connection));
    },

    getCurrentConnection: () => {
        const stored = localStorage.getItem('current_connection');
        return stored ? JSON.parse(stored) : null;
    },

    removeConnection: (ip) => {
        const connections = storage.getConnections().filter(c => c.ip !== ip);
        localStorage.setItem('pc_connections', JSON.stringify(connections));
    }
};

// API functions
async function apiCall(endpoint, options = {}) {
    if (!currentConnection || !currentConnection.ip) {
        console.error('apiCall called but no connection established:', currentConnection);
        throw new Error('No connection established');
    }
    
    const url = `http://${currentConnection.ip}:8000${endpoint}`;
    console.log('apiCall fetching URL:', url);
    const config = {
        method: 'GET',
        headers: {
            'X-API-Token': currentConnection.token || '',
            'Content-Type': 'application/json',
        },
        ...options
    };
    
    const response = await fetch(url, config);
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(error || `HTTP ${response.status}`);
    }
    
    return response;
}

async function testConnection(ip, token) {
    try {
        const url = `http://${ip}:8000/stats`;
        const response = await fetch(url, {
            headers: { 'X-API-Token': token }
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function getSystemStats() {
    const response = await apiCall('/stats');
    return await response.json();
}

async function getScreenshot() {
    const response = await apiCall('/screenshot');
    const blob = await response.blob();
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

async function listFiles(path = '') {
    const params = path ? `?path=${encodeURIComponent(path)}` : '';
    const response = await apiCall(`/files/list${params}`);
    return await response.json();
}

async function downloadFile(path) {
    const response = await apiCall(`/files/download?path=${encodeURIComponent(path)}`);
    const blob = await response.blob();
    const filename = path.split('/').pop() || path.split('\\').pop() || 'download';
    
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}

async function executeCommand(command) {
    const response = await apiCall('/command', {
        method: 'POST',
        body: JSON.stringify({ command })
    });
    return await response.json();
}

async function shutdownSystem() {
    await apiCall('/control/shutdown', { method: 'POST' });
}

async function rebootSystem() {
    await apiCall('/control/reboot', { method: 'POST' });
}

// Theme management
function initTheme() {
    const saved = localStorage.getItem('theme');
    const theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const newTheme = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

// Navigation
function showPage(pageId) {
    console.log(`showPage called with pageId: ${pageId}, currentConnection:`, currentConnection);
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.content-page').forEach(page => page.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    
    if (pageId === 'login') {
        document.getElementById('login-page').classList.add('active');
    } else {
        if (!currentConnection) {
            console.warn('No connection established, cannot show page:', pageId);
            showPage('login');
            return;
        }
        document.getElementById('main-app').classList.add('active');
        document.getElementById(`${pageId}-content`).classList.add('active');
        document.querySelector(`[data-page="${pageId}"]`).classList.add('active');
        
        // Load page content
        if (pageId === 'dashboard') {
            loadDashboard();
        } else if (pageId === 'files') {
            loadFiles();
            renderFolderIcons();
            initDiskCardClickHandlers();
        } else if (pageId === 'screenshot') {
            loadScreenshot();
        } else if (pageId === 'terminal') {
            loadTerminal();
        }
    }
}

function initDiskCardClickHandlers() {
    console.log('Initializing disk card click handlers');
    const diskCards = document.querySelectorAll('.disk-card');
    console.log(`Found ${diskCards.length} disk cards`);
    diskCards.forEach(card => {
        card.onclick = () => {
            const diskName = card.querySelector('p').textContent;
            console.log(`Disk card clicked: ${diskName}`);
            // Map diskName to path, e.g. "Local Disk (C:)" -> "C:/"
            let diskPath = '';
            if (diskName.includes('Local Disk (C:)')) {
                diskPath = 'C:/';
            } else if (diskName.includes('Data (D:)')) {
                diskPath = 'D:/';
            } else {
                // For other disks or folders, use diskName as path fallback
                diskPath = diskName;
            }
            console.log(`Mapped to path: ${diskPath}`);
            // Hide disk grid and show file list table
            const diskSection = document.querySelector('.disk-section');
            const fileTable = document.querySelector('.file-manager-table');
            if (diskSection && fileTable) {
                diskSection.style.display = 'none';
                fileTable.style.display = 'table';
            }
            // Load files for the selected disk
            pathHistory = [diskPath];
            fetchFiles(diskPath);
        };
    });
}

// Login functionality
function initLogin() {
    const form = document.getElementById('login-form');
    const nameInput = document.getElementById('pc-name');
    const connectBtn = form.querySelector('button');

    form.onsubmit = async (e) => {
        e.preventDefault();

        const name = nameInput ? nameInput.value.trim() : '';

        if (!name) {
            showToast('Please enter the device name', 'error');
            return;
        }

        currentConnection = {
            name: name || 'My Device',
            ip: 'localhost',
            token: '' // No token needed now
        };

        storage.setCurrentConnection(currentConnection);

        showToast('Connected successfully!');
        // Directly show dashboard section after connect is pressed
        showPage('dashboard');
    };
}

function loadSavedConnections() {
    const connections = storage.getConnections();
    const container = document.getElementById('saved-connections');
    const list = document.getElementById('connections-list');
    
    if (connections.length === 0) {
        container.style.display = 'none';
        return;
    }
    
    container.style.display = 'block';
    list.innerHTML = '';
    
    connections.forEach(connection => {
        const item = document.createElement('div');
        item.className = 'connection-item';
        item.innerHTML = `
            <div class="connection-info">
                <div class="connection-name">${connection.name || `PC ${connection.ip}`}</div>
                <div class="connection-ip">${connection.ip}</div>
            </div>
            <button class="delete-connection" data-ip="${connection.ip}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3,6 5,6 21,6"/>
                    <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
                </svg>
            </button>
        `;
        
        // Quick connect
        item.querySelector('.connection-info').onclick = () => {
            document.getElementById('ip-address').value = connection.ip;
            document.getElementById('access-token').value = connection.token;
            document.getElementById('pc-name').value = connection.name || '';
        };
        
        // Delete connection
        item.querySelector('.delete-connection').onclick = (e) => {
            e.stopPropagation();
            storage.removeConnection(connection.ip);
            showToast('Connection removed');
            loadSavedConnections();
        };
        
        list.appendChild(item);
    });
}

// Dashboard functionality
function loadDashboard() {
    if (!currentConnection) {
        console.warn('No connection established, skipping loadDashboard');
        return;
    }
    fetchSystemStats();
    
    // Auto-refresh every 5 seconds
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    autoRefreshInterval = setInterval(fetchSystemStats, 5000);
}

async function fetchSystemStats() {
    if (!currentConnection || !currentConnection.ip) {
        console.warn('No connection established, skipping fetchSystemStats');
        return;
    }
    try {
        const stats = await getSystemStats();
        updateStatsDisplay(stats);
    } catch (error) {
        console.error('Failed to fetch stats:', error);
        showToast('Failed to fetch system stats', 'error');
    }
}

function updateStatsDisplay(stats) {
    // CPU
    document.getElementById('cpu-usage').textContent = `${stats.cpu_percent}%`;
    document.getElementById('cpu-detail').textContent = `${stats.cpu_model || 'Unknown CPU'}`;
    
    // Memory
    document.getElementById('memory-usage').textContent = `${stats.ram_percent}%`;
    document.getElementById('memory-detail').textContent = `${formatBytes(stats.total_ram * stats.ram_percent / 100)} / ${formatBytes(stats.total_ram)}`;
    
    // Disk
    document.getElementById('disk-usage').textContent = `${stats.disk_percent}%`;
    document.getElementById('disk-detail').textContent = `${formatBytes(stats.total_storage * stats.disk_percent / 100)} / ${formatBytes(stats.total_storage)}`;
    
    // Battery
    if (stats.battery !== "N/A") {
        document.getElementById('battery-card').style.display = 'block';
        document.getElementById('battery-usage').textContent = `${stats.battery}%`;
        // No charging info in backend, so hide detail
        document.getElementById('battery-detail').textContent = '';
    } else {
        document.getElementById('battery-card').style.display = 'none';
    }
    
    // System info
    document.getElementById('os-name').textContent = stats.os_name;
    document.getElementById('os-version').textContent = stats.os_version;
    document.getElementById('os-arch').textContent = stats.os_arch;
    document.getElementById('uptime').textContent = formatUptime(stats.uptime);
}

const disksListContainerId = 'disks-list';

function loadFiles() {
    currentPath = '';
    pathHistory = [''];
    loadDisks();
    renderFolderIcons();
}

async function loadDisks() {
    const filesList = document.getElementById('files-list');
    filesList.innerHTML = '';
    const empty = document.getElementById('files-empty');
    empty.style.display = 'none';

    try {
        const response = await listFiles('');
        const disks = response.items.filter(item => item.type === 'drive');
        if (disks.length === 0) {
            empty.style.display = 'block';
            return;
        }

        disks.forEach(disk => {
            const row = document.createElement('tr');
            row.className = 'disk-row';
            row.innerHTML = `
                <td colspan="5" class="disk-name">${disk.name}</td>
            `;
            row.onclick = () => {
                pathHistory.push(disk.path);
                fetchFiles(disk.path);
            };
            filesList.appendChild(row);
        });
    } catch (error) {
        console.error('Failed to load disks:', error);
        showToast('Failed to load disks', 'error');
    }
}

async function fetchFiles(path = '') {
    const filesList = document.getElementById('files-list');
    const empty = document.getElementById('files-empty');
    filesList.innerHTML = '';
    empty.style.display = 'none';

    try {
        const response = await listFiles(path);
        const files = response.items || [];
        currentPath = path;

        updateBreadcrumb();
        updateBackButton();

        if (files.length === 0) {
            empty.style.display = 'block';
            return;
        }

        const searchTerm = document.getElementById('file-search').value.toLowerCase();

        files.forEach(file => {
            if (searchTerm && !file.name.toLowerCase().includes(searchTerm)) {
                return; // Skip files that don't match search
            }

            const row = document.createElement('tr');
            row.className = file.type === 'directory' ? 'folder-row' : 'file-row';

            // Add icon span
            const iconClass = file.type === 'directory' ? 'folder' : 'file';
            const iconSpan = `<svg class="file-icon ${iconClass}" xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                ${iconClass === 'folder' ? '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l3 4h8a2 2 0 0 1 2 2z"/>' : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a6 6 0 0 0-6-6z"/>'}
            </svg>`;

            row.innerHTML = `
                <td class="file-name">${iconSpan}${file.name}</td>
                <td class="file-size">${file.size !== undefined ? formatBytes(file.size) : ''}</td>
                <td class="file-permissions">${file.permissions || ''}</td>
                <td class="file-date">${file.modified ? formatDate(file.modified) : ''}</td>
                <td class="file-uidgid">${file.uidgid || ''}</td>
            `;
            if (file.type === 'directory') {
                row.onclick = () => {
                    pathHistory.push(file.path);
                    fetchFiles(file.path);
                };
            }
            if (file.type === 'file') {
                const downloadBtn = document.createElement('button');
                downloadBtn.className = 'download-file-btn';
                downloadBtn.title = 'Download';
                downloadBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7,10 12,15 17,10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                `;
                downloadBtn.onclick = async (e) => {
                    e.stopPropagation();
                    downloadBtn.disabled = true;
                    downloadBtn.innerHTML = '<div class="spinner" style="width: 12px; height: 12px;"></div>';
                    try {
                        await downloadFile(file.path);
                        showToast(`Downloaded ${file.name}`);
                    } catch (error) {
                        showToast(`Failed to download ${file.name}`, 'error');
                    } finally {
                        downloadBtn.disabled = false;
                        downloadBtn.innerHTML = `
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7,10 12,15 17,10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        `;
                    }
                };
                const lastTd = document.createElement('td');
                lastTd.appendChild(downloadBtn);
                row.appendChild(lastTd);
            } else {
                // For directories, add empty td for alignment
                const emptyTd = document.createElement('td');
                row.appendChild(emptyTd);
            }
            filesList.appendChild(row);
        });
    } catch (error) {
        console.error('Failed to load files:', error);
        showToast('Failed to load files', 'error');
    }
}

function updateBreadcrumb() {
    const breadcrumb = document.getElementById('breadcrumb');
    const items = [];
    
    // Root
    items.push({
        name: 'Root',
        path: '',
        index: 0
    });
    
    // Path parts
    if (currentPath) {
        const parts = currentPath.split(/[/\\]/).filter(Boolean);
        let buildPath = '';
        
        parts.forEach((part, index) => {
            buildPath += (buildPath ? '/' : '') + part;
            items.push({
                name: part,
                path: buildPath,
                index: index + 1
            });
        });
    }
    
    breadcrumb.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9,22 9,12 15,12 15,22"/>
        </svg>
        ${items.map((item, index) => `
            ${index > 0 ? '<span class="breadcrumb-separator">></span>' : ''}
            <span class="breadcrumb-item ${index === items.length - 1 ? 'active' : ''}" data-index="${item.index}">
                ${item.name}
            </span>
        `).join('')}
    `;
    
    // Add click handlers
    breadcrumb.querySelectorAll('.breadcrumb-item:not(.active)').forEach(item => {
        item.onclick = () => {
            const index = parseInt(item.dataset.index);
            const newHistory = pathHistory.slice(0, index + 1);
            const targetPath = newHistory[newHistory.length - 1];
            pathHistory = newHistory;
            fetchFiles(targetPath);
        };
    });
}

function updateBackButton() {
    const backBtn = document.getElementById('files-back-btn');
    if (!backBtn) {
        console.warn('Back button element not found');
        return;
    }
    if (pathHistory.length > 1) {
        backBtn.style.display = 'flex';
        backBtn.onclick = () => {
            if (pathHistory.length > 1) {
                pathHistory.pop();
                const previousPath = pathHistory[pathHistory.length - 1];
                fetchFiles(previousPath);
            }
        };
    } else {
        backBtn.style.display = 'none';
    }
}

// Screenshot functionality
function loadScreenshot() {
    captureScreenshot();
}

async function captureScreenshot() {
    const loading = document.getElementById('screenshot-loading');
    const display = document.getElementById('screenshot-display');
    const error = document.getElementById('screenshot-error');
    const downloadBtn = document.getElementById('download-screenshot');
    
    loading.style.display = 'block';
    display.style.display = 'none';
    error.style.display = 'none';
    downloadBtn.style.display = 'none';
    
    try {
        const imageData = await getScreenshot();
        const img = document.getElementById('screenshot-img');
        const timestamp = document.getElementById('screenshot-timestamp');
        
        img.src = imageData;
        timestamp.textContent = `Screenshot captured at ${new Date().toLocaleString()}`;
        
        loading.style.display = 'none';
        display.style.display = 'block';
        downloadBtn.style.display = 'flex';
        
        // Download functionality
        downloadBtn.onclick = () => {
            const link = document.createElement('a');
            link.href = imageData;
            link.download = `screenshot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('Screenshot downloaded');
        };
        
    } catch (error) {
        console.error('Failed to capture screenshot:', error);
        loading.style.display = 'none';
        error.style.display = 'block';
    }
}

// Terminal functionality
function loadTerminal() {
    const input = document.getElementById('terminal-input');
    input.focus();
}

function initTerminal() {
    const input = document.getElementById('terminal-input');
    const executeBtn = document.getElementById('execute-command');
    const clearBtn = document.getElementById('clear-terminal');
    
    input.onkeydown = (e) => {
        if (e.key === 'Enter') {
            executeTerminalCommand();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (commandHistoryIndex < commandHistory.length - 1) {
                commandHistoryIndex++;
                input.value = commandHistory[commandHistoryIndex];
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (commandHistoryIndex > 0) {
                commandHistoryIndex--;
                input.value = commandHistory[commandHistoryIndex];
            } else if (commandHistoryIndex === 0) {
                commandHistoryIndex = -1;
                input.value = '';
            }
        }
    };
    
    executeBtn.onclick = executeTerminalCommand;
    clearBtn.onclick = clearTerminal;
    
    // Command suggestions
    document.querySelectorAll('.suggestion-btn').forEach(btn => {
        btn.onclick = () => {
            input.value = btn.dataset.command;
            input.focus();
        };
    });
}

async function executeTerminalCommand() {
    const input = document.getElementById('terminal-input');
    const output = document.getElementById('terminal-output');
    const command = input.value.trim();
    
    if (!command || isExecuting) return;
    
    isExecuting = true;
    const executeBtn = document.getElementById('execute-command');
    executeBtn.innerHTML = '<div class="spinner" style="width: 12px; height: 12px;"></div>';
    
    try {
        const response = await executeCommand(command);
        
        // Add to history
        if (!commandHistory.includes(command)) {
            commandHistory.unshift(command);
            if (commandHistory.length > 50) {
                commandHistory.pop();
            }
        }
        
        // Display command and output
        const commandDiv = document.createElement('div');
        commandDiv.className = 'terminal-command';
        commandDiv.innerHTML = `
            <div class="terminal-timestamp">[${new Date().toLocaleTimeString()}]</div>
            <div class="terminal-command-line">$ ${command}</div>
            ${response.output ? `<div class="terminal-output-text">${response.output}</div>` : ''}
            ${response.error ? `<div class="terminal-error">${response.error}</div>` : ''}
            <div class="terminal-exit-code">Exit code: ${response.exit_code}</div>
        `;
        
        output.appendChild(commandDiv);
        output.scrollTop = output.scrollHeight;
        
        input.value = '';
        commandHistoryIndex = -1;
        
        if (response.error) {
            showToast('Command execution failed', 'error');
        }
        
    } catch (error) {
        showToast('Failed to execute command', 'error');
    } finally {
        isExecuting = false;
        executeBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22,2 15,22 11,13 2,9 22,2"/>
            </svg>
        `;
        input.focus();
    }
}

function clearTerminal() {
    const output = document.getElementById('terminal-output');
    output.innerHTML = `
        <div class="terminal-welcome">
            <p>Remote Terminal Ready</p>
            <p>Type commands and press Enter to execute</p>
            <p class="terminal-hint">Use ↑↓ arrows to navigate command history</p>
        </div>
    `;
    showToast('Terminal cleared');
}

// Control functionality
function initControl() {
    const shutdownBtn = document.getElementById('shutdown-btn');
    const rebootBtn = document.getElementById('reboot-btn');
    
    shutdownBtn.onclick = () => {
        showConfirmModal(
            'Confirm Shutdown',
            'Are you sure you want to shut down the remote PC? This action cannot be undone remotely.',
            'Shutdown',
            'danger',
            async () => {
                try {
                    await shutdownSystem();
                    showToast('Shutdown command sent successfully');
                } catch (error) {
                    showToast('Failed to send shutdown command', 'error');
                }
            }
        );
    };
    
    rebootBtn.onclick = () => {
        showConfirmModal(
            'Confirm Restart',
            'Are you sure you want to restart the remote PC? This will close all applications and restart the system.',
            'Restart',
            'warning',
            async () => {
                try {
                    await rebootSystem();
                    showToast('Reboot command sent successfully');
                } catch (error) {
                    showToast('Failed to send reboot command', 'error');
                }
            }
        );
    };
}

function showConfirmModal(title, message, confirmText, type = 'warning', onConfirm) {
    const modal = document.getElementById('confirmation-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmBtn.textContent = confirmText;
    
    if (type === 'danger') {
        confirmBtn.classList.add('danger');
    } else {
        confirmBtn.classList.remove('danger');
    }
    
    modal.classList.add('active');
    
    confirmBtn.onclick = () => {
        modal.classList.remove('active');
        onConfirm();
    };
    
    cancelBtn.onclick = () => {
        modal.classList.remove('active');
    };
    
    // Close on background click
    modal.onclick = (e) => {
        if (e.target === modal) {
            modal.classList.remove('active');
        }
    };
}

// Render folder icons
function renderFolderIcons() {
    document.getElementById('local-disk-icon').innerHTML = fileIcons.localDisk;
    document.getElementById('data-disk-icon').innerHTML = fileIcons.dataDisk;
    document.getElementById('documents-icon').innerHTML = fileIcons.documents;
    document.getElementById('downloads-icon').innerHTML = fileIcons.downloads;
    document.getElementById('pictures-icon').innerHTML = fileIcons.pictures;
    document.getElementById('music-icon').innerHTML = fileIcons.music;
    document.getElementById('videos-icon').innerHTML = fileIcons.videos;
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded event fired');
    initTheme();
    initLogin();
    initTerminal();
    initControl();
    renderFolderIcons();
    
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.onclick = (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            console.log('Navigation clicked, page:', page);
            showPage(page);
            // Update active nav item
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
        };
    });
    
    // Theme toggle
    document.getElementById('theme-toggle').onclick = toggleTheme;
    
    // Logout
    document.getElementById('logout-btn').onclick = () => {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
        }
        currentConnection = null;
        console.log('Logout clicked, showing login page');
        showPage('login');
    };
    
    // Refresh buttons
    document.getElementById('refresh-stats').onclick = fetchSystemStats;
    document.getElementById('refresh-screenshot').onclick = () => captureScreenshot();
    
currentConnection = {
    name: 'My Device',
    ip: window.location.hostname,
    token: '' // No token needed for same origin
};

console.log('Current connection set to:', currentConnection);
storage.setCurrentConnection(currentConnection);
console.log('Initial connection set:', currentConnection);
showPage('dashboard');
// Set dashboard nav item active
document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
const dashboardNav = document.querySelector('.nav-item[data-page="dashboard"]');
if (dashboardNav) {
    dashboardNav.classList.add('active');
}
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
        }
    } else {
        // Resume auto-refresh if on dashboard
        const dashboardActive = document.getElementById('dashboard-content').classList.contains('active');
        if (dashboardActive && currentConnection) {
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
            }
            autoRefreshInterval = setInterval(fetchSystemStats, 200);
        }
    }
});
