/**
 * File Manager Integration Script
 * 
 * This script demonstrates how to integrate the file manager component
 * into an existing website without affecting other code.
 */

// Function to load the file manager CSS
function loadFileManagerCSS() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'file_manager.css';
    document.head.appendChild(link);
}

// Function to create and inject the file manager component
function createFileManager(targetElement) {
    // Validate target element
    if (!targetElement) {
        console.error('Target element not found for file manager');
        return;
    }
    
    // Create file manager container
    const fileManager = document.createElement('div');
    fileManager.className = 'file-manager';
    
    // Create header
    const header = document.createElement('div');
    header.className = 'file-manager-header';
    header.innerHTML = `
        <span>File Manager</span>
        <button class="refresh-btn" title="Refresh">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 4v6h-6"/>
                <path d="M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
        </button>
    `;
    
    // Create actions section
    const actions = document.createElement('div');
    actions.className = 'file-manager-actions';
    actions.innerHTML = `
        <button class="action-btn">New Folder</button>
        <button class="action-btn">Text File</button>
        <button class="action-btn">HTML File</button>
        <button class="action-btn">Upload Files</button>
        <button class="action-btn">Settings</button>
    `;
    
    // Create folder list
    const folderList = document.createElement('div');
    folderList.className = 'folder-list';
    folderList.id = 'folderList';
    
    // Assemble file manager
    fileManager.appendChild(header);
    fileManager.appendChild(actions);
    fileManager.appendChild(folderList);
    
    // Add to target element
    targetElement.appendChild(fileManager);
    
    // Add event listener to refresh button
    const refreshBtn = fileManager.querySelector('.refresh-btn');
    refreshBtn.addEventListener('click', function() {
        this.classList.add('rotating');
        setTimeout(() => {
            this.classList.remove('rotating');
            // In a real app, this would refresh the folder list
        }, 1000);
    });
    
    // Render folder list if icons are available
    if (window.fileIcons) {
        renderFolderList(folderList);
    } else {
        folderList.innerHTML = '<p style="padding: 10px;">Error loading icons. Please check if icons.js is properly loaded.</p>';
    }
    
    return fileManager;
}

// Function to render folder list
function renderFolderList(folderList) {
    // Define folder names for display
    const folderData = [
        { key: 'localDisk', name: 'Local Disk (C:)' },
        { key: 'dataDisk', name: 'Data (D:)' },
        { key: 'documents', name: 'Documents' },
        { key: 'downloads', name: 'Downloads' },
        { key: 'pictures', name: 'Pictures' },
        { key: 'music', name: 'Music' },
        { key: 'videos', name: 'Videos' }
    ];
    
    // Create a folder item for each icon
    folderData.forEach(folder => {
        const folderItem = document.createElement('div');
        folderItem.className = 'folder-item';
        
        const folderIcon = document.createElement('div');
        folderIcon.className = 'folder-icon';
        folderIcon.innerHTML = window.fileIcons[folder.key];
        
        const folderName = document.createElement('div');
        folderName.className = 'folder-name';
        folderName.textContent = folder.name;
        
        folderItem.appendChild(folderIcon);
        folderItem.appendChild(folderName);
        folderList.appendChild(folderItem);
        
        // Add click event
        folderItem.addEventListener('click', function() {
            // Remove active class from all items
            folderList.querySelectorAll('.folder-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Add active class to clicked item
            this.classList.add('active');
            
            // Trigger custom event for folder selection
            const event = new CustomEvent('folderSelected', {
                detail: {
                    key: folder.key,
                    name: folder.name
                }
            });
            folderList.dispatchEvent(event);
        });
    });
}

// Function to initialize the file manager
function initFileManager(targetSelector) {
    // Load CSS
    loadFileManagerCSS();
    
    // Wait for DOM to be ready
    document.addEventListener('DOMContentLoaded', function() {
        // Find target element
        const targetElement = document.querySelector(targetSelector);
        
        // Create file manager
        const fileManager = createFileManager(targetElement);
        
        // Listen for folder selection events
        if (fileManager) {
            const folderList = fileManager.querySelector('#folderList');
            folderList.addEventListener('folderSelected', function(event) {
                console.log('Folder selected:', event.detail);
                // Handle folder selection in your application
            });
        }
    });
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initFileManager,
        createFileManager,
        renderFolderList
    };
}

// Make available globally
if (typeof window !== 'undefined') {
    window.FileManagerIntegration = {
        init: initFileManager,
        create: createFileManager,
        renderFolderList: renderFolderList
    };
}