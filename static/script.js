let currentGames = [];
let runningGames = new Set();
let runningPresets = new Set();
let quickActionsEnabled = false;
let currentTheme = localStorage.getItem('theme') || 'dark';
let presetToDelete = null;
let presetToRename = null;
let presetToEdit = null;
let editedGames = [];
let welcomeStartupEnabled = false;
let welcomeMinimizeEnabled = false;
let welcomeIdleExePath = null;
let currentViewSize = localStorage.getItem('libraryViewSize') || 'normal'; // compact, normal, large

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    await checkFirstTimeSetup();
    await updateSteamStatus();
    await updateStatistics();
    await updateQuickActions();
    applyTheme(currentTheme);
    
    // Add event listeners for library functionality
    const librarySearch = document.getElementById('librarySearch');
    if (librarySearch) {
        librarySearch.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            updateLibraryDisplay();
        });
    }
    
    // Add click outside listener for library modal
    const libraryModal = document.getElementById('libraryModal');
    if (libraryModal) {
        libraryModal.addEventListener('click', (e) => {
            if (e.target === libraryModal) {
                closeLibrary();
            }
        });
    }

    // Library action buttons
    const createPresetBtn = document.querySelector('button[onclick="createPresetFromSelected()"]');
    if (createPresetBtn) {
        createPresetBtn.addEventListener('click', createPresetFromSelected);
    }

    const startSelectedBtn = document.querySelector('button[onclick="startSelectedGames()"]');
    if (startSelectedBtn) {
        startSelectedBtn.addEventListener('click', startSelectedGames);
    }

    // Update library display when games are started/stopped
    document.addEventListener('gameStateChanged', async function() {
        updateLibraryDisplay();
        updateGamesList();
        updateRunningGamesList();
        const presets = await loadPresets(true);
        updatePresetsList(presets);
    });
});

// Add status checking intervals
setInterval(updateGameStatuses, 5000); // Check every 5 seconds
setInterval(updatePlaytimes, 1000); // Update playtimes every second
setInterval(updateSteamStatus, 10000); // Check Steam status every 10 seconds
setInterval(updateStatistics, 5000); // Update statistics every 5 seconds
setInterval(updateQuickActions, 5000); // Update quick actions panel

async function updateGameStatuses() {
    for (const game of currentGames) {
        await checkGameStatus(game.id);
    }
}

async function checkGameStatus(gameId) {
    try {
        const response = await fetch('/api/game-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId })
        });

        const data = await response.json();
        if (data.status === 'success') {
            const wasRunning = runningGames.has(gameId);
            if (data.running) {
                runningGames.add(gameId);
            } else {
                runningGames.delete(gameId);
            }
            if (wasRunning !== data.running) {
                updateGamesList();
            }
        }
    } catch (error) {
        console.error('Error checking game status:', error);
    }
}

async function fetchGame() {
    const gameInput = document.getElementById('gameId').value.trim();
    if (!gameInput) {
        showNotification('Please input game ID or Name', 'error');
        return;
    }

    try {
        const response = await fetch('/api/fetch-game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId: gameInput })
        });

        const gameInfo = await response.json();
        if (gameInfo.error) {
            showNotification(gameInfo.error, 'error');
            return;
        }
        addGameToList(gameInfo);
        document.getElementById('gameId').value = '';
    } catch (error) {
        console.error('Error fetching game:', error);
        showNotification('Failed to fetch game info', 'error');
    }
}

function addGameToList(gameInfo) {
    if (currentGames.some(game => game.id === gameInfo.id)) {
        alert('This game is already in the list!');
        return;
    }

    currentGames.push(gameInfo);
    updateGamesList();
}

function removeGame(gameId) {
    currentGames = currentGames.filter(game => game.id !== gameId);
    updateGamesList();
}

function updateGamesList() {
    const gamesList = document.getElementById('gamesList');
    gamesList.innerHTML = '';

    currentGames.forEach(game => {
        const isRunning = runningGames.has(game.id);
        const gameCard = document.createElement('div');
        gameCard.className = 'game-card bg-gray-800 rounded-lg p-4 relative';
        gameCard.setAttribute('data-game-id', game.id);
        gameCard.innerHTML = `
            <div class="relative">
                <img src="${game.image || 'https://via.placeholder.com/460x215/374151/FFFFFF?text=No+Image'}" 
                     alt="${game.name}" 
                     class="w-full h-40 object-cover rounded mb-4">
                ${isRunning ? '<div class="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded text-xs">Running</div>' : ''}
            </div>
            <h3 class="text-lg font-semibold mb-2">${game.name}</h3>
            <p class="text-gray-400 mb-2">ID: ${game.id}</p>
            <div class="playtime-info mb-4 text-sm">
                ${isRunning ? '<div class="text-gray-400">Loading playtime...</div>' : ''}
            </div>
            <div class="flex gap-2 mt-2">
                <button onclick="${isRunning ? 'stopGame' : 'startGame'}('${game.id}')" 
                        class="flex-1 bg-${isRunning ? 'red' : 'green'}-500 hover:bg-${isRunning ? 'red' : 'green'}-600 px-4 py-2 rounded text-sm font-medium">
                    <i class="fas fa-${isRunning ? 'stop' : 'play'} mr-1"></i>${isRunning ? 'Stop' : 'Start'}
                </button>
                <button onclick="removeGame('${game.id}')" 
                        class="flex-1 bg-gray-500 hover:bg-gray-600 px-4 py-2 rounded text-sm font-medium"
                        ${isRunning ? 'disabled' : ''}>
                    <i class="fas fa-times mr-1"></i>Remove
                </button>
            </div>
        `;
        gamesList.appendChild(gameCard);
    });
}

async function savePreset() {
    if (currentGames.length === 0) {
        showNotification('Please add games to the preset first', 'error');
        return;
    }

    const presetName = document.getElementById('presetName').value.trim();
    if (!presetName) {
        showNotification('Please enter a preset name', 'error');
        return;
    }

    try {
        const response = await fetch('/api/save-preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: presetName,
                games: currentGames
            })
        });

        if (response.ok) {
            showNotification('Preset saved successfully', 'success');
            document.getElementById('presetName').value = '';
            currentGames = [];
            cleanupSaveHighlight(); // Clean up the highlighting
            loadPresets();
        } else {
            showNotification('Failed to save preset', 'error');
        }
    } catch (error) {
        console.error('Error saving preset:', error);
        showNotification('Failed to save preset', 'error');
    }
}

// Add this function to clean up the save button highlighting
function cleanupSaveHighlight() {
    const saveButton = document.querySelector('button[onclick="savePreset()"]');
    const reminderText = document.querySelector('.save-reminder');
    
    if (saveButton) {
        saveButton.classList.remove('save-button-highlight', 'pulse-animation');
    }
    if (reminderText) {
        reminderText.remove();
    }
}

// Add event listener for the save preset input to handle Enter key
document.addEventListener('DOMContentLoaded', function() {
    const savePresetInput = document.getElementById('savePresetNameInput');
    if (savePresetInput) {
        savePresetInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                confirmSavePreset();
            }
        });
    }
    
    // Add click outside listener to close the modal
    const savePresetModal = document.getElementById('savePresetModal');
    if (savePresetModal) {
        savePresetModal.addEventListener('click', (e) => {
            if (e.target === savePresetModal) {
                closeSavePresetModal();
            }
        });
    }
});

async function loadPresets(returnData = false) {
    try {
        const response = await fetch('/api/get-presets');
        const presets = await response.json();
        if (!returnData) {
            updatePresetsList(presets);
        }
        return presets;
    } catch (error) {
        console.error('Error loading presets:', error);
        showNotification('Failed to load presets', 'error');
        return [];
    }
}

async function updatePresetsList(presets) {
    const presetsList = document.getElementById('presetsList');
    if (!presetsList) return;
    
    presetsList.innerHTML = '';
    
    // Get favorites data
    const favoritesResponse = await fetch('/api/favorites');
    const favoritesData = await favoritesResponse.json();
    const favoriteNames = favoritesData.favorites.map(f => f.name);

    presets.forEach(preset => {
        const presetCard = document.createElement('div');
        presetCard.className = 'preset-card bg-gray-800 rounded-lg p-4';
        
        // Check if all games in the preset are running
        const isPresetRunning = preset.games.every(game => runningGames.has(game.id.toString()));
        
        // Check if preset is favorited
        const isFavorited = favoriteNames.includes(preset.name);
        
        // Create a hidden games list that will be shown when clicking Show Info
        const gamesList = preset.games.map(game => {
            const isGameRunning = runningGames.has(game.id.toString());
            return `<li class="flex items-center gap-2 text-gray-400 py-3 border-b border-gray-700 last:border-0" data-preset-game-id="${game.id}">
                <img src="${game.image}" alt="${game.name}" class="w-8 h-8 rounded">
                <div class="flex-1">
                    <span class="block">${game.name}</span>
                    <div class="flex items-center gap-2">
                        <span class="text-sm text-gray-500">ID: ${game.id}</span>
                        ${isGameRunning ? '<span class="text-green-500 text-xs">● Running</span>' : ''}
                    </div>
                    <div class="preset-game-playtime text-xs mt-1 space-y-1">
                        ${isGameRunning ? 
                            `<div class="text-green-400">Loading playtime...</div>` : 
                            `<div class="text-gray-500">Not running</div>`
                        }
                    </div>
                </div>
                <div class="flex flex-col gap-2 items-end">
                    <button onclick="${isGameRunning ? 'stopGame' : 'startGame'}('${game.id}')" 
                            class="bg-${isGameRunning ? 'red' : 'green'}-500 hover:bg-${isGameRunning ? 'red' : 'green'}-600 px-3 py-1 rounded text-sm">
                        <i class="fas fa-${isGameRunning ? 'stop' : 'play'} mr-1"></i>${isGameRunning ? 'Stop' : 'Start'}
                    </button>
                </div>
            </li>`;
        }).join('');

        presetCard.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center gap-3">
                    <h3 class="text-lg font-semibold">${preset.name}</h3>
                    <div class="flex gap-2">
                        <button onclick="${isFavorited ? 'removeFavorite' : 'addFavorite'}('${preset.name}')" 
                                class="text-${isFavorited ? 'yellow' : 'gray'}-500 hover:text-yellow-400 transition-colors duration-200 ${isFavorited ? 'glow-yellow' : ''}">
                            <i class="fas fa-star"></i>
                        </button>
                        <button onclick="showRenamePresetModal('${preset.name}')"
                                class="text-blue-500 hover:text-blue-400 transition-colors">
                            <i class="fas fa-edit"></i>
                        </button>
                    </div>
                </div>
                <div class="flex gap-2">
                    <button onclick="${isPresetRunning ? 'stopPreset' : 'runPreset'}('${preset.name}')" 
                            class="bg-${isPresetRunning ? 'red' : 'green'}-500 hover:bg-${isPresetRunning ? 'red' : 'green'}-600 px-4 py-2 rounded text-sm">
                        <i class="fas fa-${isPresetRunning ? 'stop' : 'play'} mr-1"></i>${isPresetRunning ? 'Stop All' : 'Run All'}
                    </button>
                    <button onclick="showEditPresetModal('${preset.name}')"
                            class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded text-sm">
                        <i class="fas fa-cog mr-1"></i>Edit Games
                    </button>
                    <button onclick="togglePresetInfo(this)" 
                            class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded text-sm">
                        <i class="fas fa-info-circle mr-1"></i>Show Info
                    </button>
                    <button onclick="deletePreset('${preset.name}')" 
                            class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded text-sm"
                            ${isPresetRunning ? 'disabled' : ''}>
                        <i class="fas fa-trash mr-1"></i>Delete
                    </button>
                </div>
            </div>
            <div class="games-info hidden">
                <div class="flex justify-between items-center text-sm text-gray-400 mb-4">
                    <div>
                        Games in preset: ${preset.games.length}
                        ${isPresetRunning ? ' <span class="text-green-500">(All Running)</span>' : ''}
                    </div>
                </div>
                <ul class="space-y-2 max-h-48 overflow-y-auto">
                    ${gamesList}
                </ul>
            </div>
        `;
        presetsList.appendChild(presetCard);

        // If any games are running, trigger an immediate playtime update
        if (preset.games.some(game => runningGames.has(game.id.toString()))) {
            updatePlaytimes();
        }
    });
}

function togglePresetInfo(button) {
    const gamesInfo = button.closest('.preset-card').querySelector('.games-info');
    const isHidden = gamesInfo.classList.contains('hidden');
    
    // Update button text
    button.innerHTML = isHidden ? 
        '<i class="fas fa-times mr-1"></i>Hide Info' : 
        '<i class="fas fa-info-circle mr-1"></i>Show Info';
    
    // Toggle button color
    button.classList.toggle('bg-blue-500');
    button.classList.toggle('bg-gray-500');
    
    // Toggle games list visibility
    gamesInfo.classList.toggle('hidden');
}

async function updateSteamStatus() {
    try {
        const response = await fetch('/api/steam-status');
        const status = await response.json();
        
        // Update Steam status indicator and button
        const statusIndicator = document.getElementById('steamStatus');
        const steamButton = document.getElementById('steamButton');
        
        if (statusIndicator && steamButton) {
            if (status.running && status.online) {
                statusIndicator.className = 'text-green-500';
                statusIndicator.innerHTML = '<i class="fas fa-circle mr-1"></i>Steam Online';
                // Update button
                steamButton.innerHTML = '<i class="fas fa-external-link-alt mr-1"></i><span>Show Steam</span>';
            } else if (status.running) {
                statusIndicator.className = 'text-yellow-500';
                statusIndicator.innerHTML = '<i class="fas fa-circle mr-1"></i>Steam Offline';
                // Update button
                steamButton.innerHTML = '<i class="fas fa-play mr-1"></i><span>Launch Steam</span>';
            } else {
                statusIndicator.className = 'text-red-500';
                statusIndicator.innerHTML = '<i class="fas fa-circle mr-1"></i>Steam Not Running';
                // Update button
                steamButton.innerHTML = '<i class="fas fa-play mr-1"></i><span>Launch Steam</span>';
            }
        }
        
        return status;
    } catch (error) {
        console.error('Error checking Steam status:', error);
        return null;
    }
}

async function launchSteam() {
    try {
        const response = await fetch('/api/launch-steam');
        const result = await response.json();
        
        if (result.status === 'success') {
            showNotification('Steam launch initiated', 'info');
            // Wait a bit and check status
            setTimeout(updateSteamStatus, 5000);
        } else {
            showNotification('Failed to launch Steam', 'error');
        }
    } catch (error) {
        console.error('Error launching Steam:', error);
        showNotification('Failed to launch Steam', 'error');
    }
}

// Add these functions for the Steam launch modal
function showSteamLaunchModal() {
    const modal = document.getElementById('steamLaunchModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSteamLaunchModal() {
    const modal = document.getElementById('steamLaunchModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function confirmSteamLaunch() {
    closeSteamLaunchModal();
    await launchSteam();
    showNotification('Please try starting the game again once Steam is running', 'info');
}

// Update the startGame function
async function startGame(gameId) {
    try {
        const response = await fetch('/api/start-game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId })
        });

        if (response.ok) {
            runningGames.add(gameId.toString());
            triggerGameStateChange();
            showNotification('Game started successfully', 'success');
            updateRunningGamesList(); // Add this line
        } else {
            showNotification('Failed to start game', 'error');
        }
    } catch (error) {
        console.error('Error starting game:', error);
        showNotification('Error starting game', 'error');
    }
}

async function stopGame(gameId) {
    try {
        const response = await fetch('/api/stop-game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId })
        });

        if (response.ok) {
            runningGames.delete(gameId.toString());
            triggerGameStateChange();
            showNotification('Game stopped successfully', 'success');
            updateRunningGamesList(); // Add this line
        } else {
            showNotification('Failed to stop game', 'error');
        }
    } catch (error) {
        console.error('Error stopping game:', error);
        showNotification('Error stopping game', 'error');
    }
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(button => {
        button.classList.remove('active', 'border-blue-500', 'text-blue-500');
        button.classList.add('border-transparent', 'text-gray-400');
    });
    document.getElementById(`${tabName}Tab`).classList.add('active', 'border-blue-500', 'text-blue-500');
    
    // Update content visibility
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.add('hidden');
    });
    document.getElementById(`${tabName}Content`).classList.remove('hidden');

    // Initialize statistics if switching to stats tab
    if (tabName === 'stats') {
        updateStatistics();
    }
}

async function importBatFile(file) {
    const loadingOverlay = document.getElementById('importLoadingOverlay');
    const statusText = document.getElementById('importStatus');
    const saveButton = document.querySelector('button[onclick="savePreset()"]');
    
    try {
        loadingOverlay.classList.remove('hidden');
        statusText.textContent = 'Analyzing BAT file...';
        
        const reader = new FileReader();
        
        reader.onload = async function(e) {
            try {
                const content = e.target.result;
                statusText.textContent = 'Extracting game IDs...';
                
                // Extract game IDs from the BAT file
                const gameIds = content.match(/steam-idle\.exe\s+(\d+)/g)
                    ?.map(match => match.match(/\d+/)[0]) || [];
                
                if (gameIds.length === 0) {
                    throw new Error('No valid game IDs found in the BAT file');
                }
                
                // Clear current games list
                currentGames = [];
                
                // Fetch game info for each ID
                for (let i = 0; i < gameIds.length; i++) {
                    statusText.textContent = `Fetching game info (${i + 1}/${gameIds.length})...`;
                    
                    const response = await fetch('/api/fetch-game', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ gameId: gameIds[i] })
                    });
                    
                    if (response.ok) {
                        const gameInfo = await response.json();
                        if (!currentGames.some(game => game.id === gameInfo.id)) {
                            currentGames.push(gameInfo);
                        }
                    }
                    
                    // Add a small delay to prevent overwhelming the Steam API
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                statusText.textContent = 'Finalizing import...';
                
                // Set the preset name from the file name
                const fileName = file.name.replace('.bat', '');
                document.getElementById('presetName').value = fileName;
                
                // Show success notification with save reminder
                showNotification(`Successfully imported ${currentGames.length} games. Please click Save to confirm the preset.`, 'info');
                
                // Highlight save button with animation
                saveButton.classList.add('save-button-highlight');
                
                // Add pulsing animation to save button
                saveButton.classList.add('pulse-animation');
                
                // Show save reminder text
                const reminderText = document.createElement('div');
                reminderText.className = 'text-sm text-blue-400 mt-2 text-center save-reminder';
                reminderText.innerHTML = '<i class="fas fa-arrow-left animate-slide-left mr-2"></i>Click Save to confirm preset';
                saveButton.parentElement.appendChild(reminderText);
                
            } catch (error) {
                console.error('Error processing BAT file:', error);
                showNotification(error.message || 'Failed to process BAT file', 'error');
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        };
        
        reader.onerror = function() {
            loadingOverlay.classList.add('hidden');
            showNotification('Error reading BAT file', 'error');
        };
        
        reader.readAsText(file);
        
    } catch (error) {
        console.error('Error importing BAT file:', error);
        showNotification('Failed to import BAT file', 'error');
        loadingOverlay.classList.add('hidden');
    }
}

function showDeletePresetModal(presetName) {
    presetToDelete = presetName;
    const modal = document.getElementById('deletePresetModal');
    const presetNameSpan = document.getElementById('deletePresetName');
    presetNameSpan.textContent = presetName;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeDeletePresetModal() {
    const modal = document.getElementById('deletePresetModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    presetToDelete = null;
}

async function confirmDeletePreset() {
    if (!presetToDelete) return;
    
    try {
        const response = await fetch('/api/delete-preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: presetToDelete })
        });

        if (response.ok) {
            showNotification(`Preset "${presetToDelete}" deleted successfully`, 'success');
            updatePresetsList(await loadPresets(true));
            updateFavoritePresets();
        } else {
            showNotification('Failed to delete preset', 'error');
        }
    } catch (error) {
        console.error('Error deleting preset:', error);
        showNotification('Failed to delete preset', 'error');
    }
    
    closeDeletePresetModal();
}

// Update the existing deletePreset function
async function deletePreset(presetName) {
    showDeletePresetModal(presetName);
}

async function stopPreset(presetName) {
    try {
        // Get the preset data
        const response = await fetch('/api/get-presets');
        const presets = await response.json();
        const preset = presets.find(p => p.name === presetName);
        
        if (!preset) {
            throw new Error('Preset not found');
        }

        // Stop each game in the preset
        for (const game of preset.games) {
            if (runningGames.has(game.id.toString())) {
                await stopGame(game.id);
            }
        }

        // Remove from running presets
        runningPresets.delete(presetName);

        // Update UI with fresh data
        updateGamesList();
        const updatedPresets = await loadPresets(true);
        updatePresetsList(updatedPresets);
        
        // Show success message
        showNotification(`Stopped all games in preset "${presetName}"`, 'success');
    } catch (error) {
        console.error('Error stopping preset:', error);
        showNotification('Failed to stop preset', 'error');
    }
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `fixed bottom-4 right-4 px-6 py-3 rounded-lg text-white text-sm font-medium shadow-lg transform transition-all duration-300 translate-y-0 opacity-100 ${
        type === 'success' ? 'bg-green-500' : 
        type === 'error' ? 'bg-red-500' : 
        'bg-blue-500'
    }`;
    notification.textContent = message;

    // Add to document
    document.body.appendChild(notification);

    // Animate out and remove after 3 seconds
    setTimeout(() => {
        notification.style.transform = 'translateY(20px)';
        notification.style.opacity = '0';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

async function updatePlaytimes() {
    // Update playtimes for all running games
    for (const gameId of runningGames) {
        try {
            const response = await fetch('/api/game-session-time', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ gameId })
            });

            const data = await response.json();
            
            // Update game card playtime
            const gameCard = document.querySelector(`[data-game-id="${gameId}"]`);
            if (gameCard) {
                const playtimeElement = gameCard.querySelector('.playtime-info');
                if (playtimeElement) {
                    playtimeElement.innerHTML = `
                        <div class="text-green-400">Current Session: ${data.current_session}</div>
                        <div class="text-blue-400">Total Time: ${data.total_time}</div>
                    `;
                }
            }

            // Update preset card playtime if game is in any preset
            const presetGameElements = document.querySelectorAll(`[data-preset-game-id="${gameId}"]`);
            presetGameElements.forEach(element => {
                const playtimeElement = element.querySelector('.preset-game-playtime');
                if (playtimeElement) {
                    playtimeElement.innerHTML = `
                        <div class="text-xs">Session: ${data.current_session}</div>
                        <div class="text-xs">Total: ${data.total_time}</div>
                    `;
                }
            });
        } catch (error) {
            console.error('Error updating playtime:', error);
        }
    }
}

// Update the runPreset function
async function runPreset(presetName) {
    try {
        // Check Steam status first
        const steamStatus = await updateSteamStatus();
        if (!steamStatus) {
            showNotification('Unable to check Steam status', 'error');
            return;
        }
        
        if (!steamStatus.running) {
            showSteamLaunchModal();
            return;
        }
        
        if (!steamStatus.online) {
            showNotification('Steam appears to be offline. Please ensure Steam is online.', 'error');
            return;
        }

        // Get the preset data first
        const presetsResponse = await fetch('/api/get-presets');
        const presets = await presetsResponse.json();
        const preset = presets.find(p => p.name === presetName);
        
        if (!preset) {
            showNotification('Preset not found', 'error');
            return;
        }
        
        const response = await fetch('/api/run-preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: presetName })
        });

        if (!response.ok) {
            const data = await response.json();
            showNotification(data.message || 'Failed to run preset', 'error');
            return;
        }

        const data = await response.json();
        if (data.status === 'success') {
            // Update running games set
            data.gameIds.forEach(gameId => {
                runningGames.add(gameId.toString());
            });

            // Add preset games to currentGames if they're not already there
            preset.games.forEach(game => {
                if (!currentGames.some(g => g.id === game.id)) {
                    currentGames.push(game);
                }
            });

            // Add to running presets
            runningPresets.add(presetName);

            // Update UI
            updateGamesList();
            updatePresetsList(await loadPresets(true));
            updateRunningGamesList(); // Add this line
            
            // Show success message
            const message = `Started ${data.gameIds.length} games from preset "${presetName}"`;
            showNotification(message, 'success');
        }
    } catch (error) {
        console.error('Error running preset:', error);
        showNotification('Failed to run preset', 'error');
    }
}

async function updateStatistics() {
    if (document.getElementById('statsContent').classList.contains('hidden')) {
        return; // Don't update if stats tab is not visible
    }

    try {
        // Get base total playtime from server
        const totalResponse = await fetch('/api/stats/total-playtime');
        const totalData = await totalResponse.json();
        let totalSeconds = totalData.total_seconds;

        // Add current session times for running games
        const currentTime = new Date();
        for (const gameId of runningGames) {
            const response = await fetch('/api/game-session-time', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ gameId })
            });
            const data = await response.json();
            
            // Extract seconds from HH:MM:SS format of current_session
            const [hours, minutes, seconds] = data.current_session.split(':').map(Number);
            totalSeconds += hours * 3600 + minutes * 60 + seconds;
        }

        // Update total playtime display
        document.getElementById('totalPlaytime').textContent = formatDuration(totalSeconds);
    } catch (error) {
        console.error('Error updating total playtime:', error);
    }

    // Update most idled games
    try {
        const idledResponse = await fetch('/api/stats/most-idled');
        const idledGames = await idledResponse.json();
        const mostIdledContainer = document.getElementById('mostIdledGames');
        mostIdledContainer.innerHTML = idledGames.map((game, index) => `
            <div class="flex items-center gap-4 bg-gray-700 p-2 rounded">
                <div class="text-xl font-bold text-gray-400 w-8">#${index + 1}</div>
                <img src="${game.image}" alt="${game.name}" class="w-8 h-8 rounded">
                <div class="flex-1">
                    <div class="font-medium">${game.name}</div>
                    <div class="text-sm text-gray-400">${game.total_time}</div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error updating most idled games:', error);
    }
}

// Helper function to format duration in seconds to HH:MM:SS
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Initialize
document.getElementById('gameId').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') fetchGame();
});

document.getElementById('presetName').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') savePreset();
});

document.getElementById('presetFile').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        importBatFile(e.target.files[0]);
        e.target.value = ''; // Reset file input
    }
});

// Set initial active tab
switchTab('games');

// Load presets on page load
loadPresets();

// Quick Actions Panel Functions
async function updateQuickActions() {
    if (!quickActionsEnabled) return; // Don't update if panel is hidden
    
    await Promise.all([
        updateFavoritePresets(),
        updateRecentActions(),
        updateCustomShortcuts()
    ]);
}

async function updateFavoritePresets() {
    try {
        const response = await fetch('/api/favorites');
        const data = await response.json();
        const container = document.getElementById('favoritePresets');
        
        container.innerHTML = `
            <div class="max-h-40 overflow-y-auto space-y-2">
                ${data.favorites.map(favorite => `
                    <div class="flex items-center justify-between bg-gray-800 p-2 rounded">
                        <div class="flex items-center">
                            <i class="fas fa-gamepad mr-2 text-blue-400"></i>
                            <span>${favorite.name}</span>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="runPreset('${favorite.name}')" class="bg-green-500 hover:bg-green-600 px-3 py-1 rounded text-xs">
                                <i class="fas fa-play mr-1"></i>Run
                            </button>
                            <button onclick="removeFavorite('${favorite.name}')" class="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-xs">
                                <i class="fas fa-star mr-1"></i>Unfavorite
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        ` || '<div class="text-gray-400 text-sm">No favorite presets</div>';
    } catch (error) {
        console.error('Error updating favorite presets:', error);
    }
}

// Add this function before updateRecentActions
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    if (diffInSeconds < 60) {
        return 'Just now';
    } else if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    } else if (diffInSeconds < 86400) {
        const hours = Math.floor(diffInSeconds / 3600);
        return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    } else {
        const days = Math.floor(diffInSeconds / 86400);
        return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    }
}

async function updateRecentActions() {
    try {
        const response = await fetch('/api/recent-actions');
        const data = await response.json();
        const container = document.getElementById('recentActions');
        
        container.innerHTML = data.actions.map(action => `
            <div class="flex items-center justify-between bg-gray-800 p-2 rounded text-sm">
                <div class="flex items-center">
                    <i class="fas fa-circle text-xs mr-2 text-blue-400"></i>
                    <span>${action.action}</span>
                </div>
                <span class="text-gray-400 text-xs">${formatTimestamp(action.timestamp)}</span>
            </div>
        `).join('') || '<div class="text-gray-400 text-sm">No recent actions</div>';
    } catch (error) {
        console.error('Error updating recent actions:', error);
    }
}

async function updateCustomShortcuts() {
    try {
        const response = await fetch('/api/shortcuts');
        const data = await response.json();
        const container = document.getElementById('customShortcuts');
        
        container.innerHTML = `
            <div class="max-h-40 overflow-y-auto space-y-2">
                ${data.shortcuts.map(shortcut => `
                    <div class="flex items-center justify-between bg-gray-800 p-2 rounded">
                        <div class="flex-1">
                            <div class="font-medium">${shortcut.name}</div>
                            <div class="text-sm text-gray-400">
                                <span class="bg-gray-700 px-2 py-1 rounded">${shortcut.key_combination}</span>
                                → ${shortcut.preset_name}
                            </div>
                        </div>
                        <button onclick="deleteShortcut('${shortcut.id}')" class="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-xs ml-2">
                            <i class="fas fa-trash mr-1"></i>Delete
                        </button>
                    </div>
                `).join('')}
            </div>
        ` || '<div class="text-gray-400 text-sm">No custom shortcuts</div>';
    } catch (error) {
        console.error('Error updating custom shortcuts:', error);
    }
}

async function addFavorite(presetName) {
    try {
        const response = await fetch('/api/favorites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ preset_name: presetName })
        });
        
        if (response.ok) {
            // Update star icon
            const starButton = document.querySelector(`button[onclick="removeFavorite('${presetName}')"]`);
            if (starButton) {
                starButton.classList.remove('text-gray-500');
                starButton.classList.add('text-yellow-500', 'glow-yellow');
                starButton.setAttribute('onclick', `removeFavorite('${presetName}')`);
            }
            showNotification(`Added ${presetName} to favorites`, 'success');
            updateFavoritePresets();
            updatePresetsList(await loadPresets(true));
        }
    } catch (error) {
        console.error('Error adding favorite:', error);
        showNotification('Failed to add favorite', 'error');
    }
}

async function removeFavorite(presetName) {
    try {
        const response = await fetch('/api/favorites', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ preset_name: presetName })
        });
        
        if (response.ok) {
            // Update star icon
            const starButton = document.querySelector(`button[onclick="addFavorite('${presetName}')"]`);
            if (starButton) {
                starButton.classList.remove('text-yellow-500', 'glow-yellow');
                starButton.classList.add('text-gray-500');
                starButton.setAttribute('onclick', `addFavorite('${presetName}')`);
            }
            showNotification(`Removed ${presetName} from favorites`, 'success');
            updateFavoritePresets();
            updatePresetsList(await loadPresets(true));
        }
    } catch (error) {
        console.error('Error removing favorite:', error);
        showNotification('Failed to remove favorite', 'error');
    }
}

async function emergencyStop() {
    try {
        const response = await fetch('/api/emergency-stop');
        const data = await response.json();
        
        if (data.status === 'success') {
            runningGames.clear();
            updateGamesList();
            updatePresetsList(await loadPresets(true));
            updateRunningGamesList(); // Add this line
            showNotification(`Emergency stop successful - Stopped ${data.stopped_games.length} games`, 'success');
            closeRunningGames(); // Close the modal after emergency stop
        }
    } catch (error) {
        console.error('Error during emergency stop:', error);
        showNotification('Failed to stop all games', 'error');
    }
}

let shortcutToDelete = null;

async function deleteShortcut(shortcutId) {
    shortcutToDelete = shortcutId;
    const modal = document.getElementById('deleteShortcutModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeDeleteShortcutModal() {
    const modal = document.getElementById('deleteShortcutModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    shortcutToDelete = null;
}

async function confirmDeleteShortcut() {
    if (!shortcutToDelete) return;
    
    try {
        const response = await fetch('/api/shortcuts', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id: shortcutToDelete })
        });
        
        if (response.ok) {
            showNotification('Shortcut deleted successfully', 'success');
            updateCustomShortcuts();
        }
    } catch (error) {
        console.error('Error deleting shortcut:', error);
        showNotification('Failed to delete shortcut', 'error');
    } finally {
        closeDeleteShortcutModal();
    }
}

// Add click handlers for modal backgrounds to close on click outside
document.addEventListener('DOMContentLoaded', () => {
    const emergencyStopModal = document.getElementById('emergencyStopModal');
    const deleteShortcutModal = document.getElementById('deleteShortcutModal');

    emergencyStopModal.addEventListener('click', (e) => {
        if (e.target === emergencyStopModal) {
            closeEmergencyStopModal();
        }
    });

    deleteShortcutModal.addEventListener('click', (e) => {
        if (e.target === deleteShortcutModal) {
            closeDeleteShortcutModal();
        }
    });
});

// Shortcut Modal Functions
let recordingKeys = false;
let currentKeyCombination = [];

function openShortcutModal() {
    const modal = document.getElementById('shortcutModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Reset form
    document.getElementById('shortcutNameInput').value = '';
    document.getElementById('keyCombinationInput').value = '';
    document.getElementById('clearKeyCombination').classList.add('hidden');
    currentKeyCombination = [];
    
    // Load presets into select
    loadPresets(true).then(presets => {
        const select = document.getElementById('presetSelect');
        select.innerHTML = '<option value="">Select a preset</option>' + 
            presets.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    });
}

function closeShortcutModal() {
    const modal = document.getElementById('shortcutModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    recordingKeys = false;
}

function clearKeyCombination() {
    document.getElementById('keyCombinationInput').value = '';
    document.getElementById('clearKeyCombination').classList.add('hidden');
    currentKeyCombination = [];
}

// Initialize key combination recording with click handler
document.addEventListener('DOMContentLoaded', function() {
    const keyCombinationInput = document.getElementById('keyCombinationInput');
    
    keyCombinationInput.addEventListener('click', function(e) {
        e.preventDefault();
        recordingKeys = true;
        this.value = 'Press your key combination...';
        currentKeyCombination = [];
        this.classList.add('recording');
    });

    // Handle key recording
    document.addEventListener('keydown', function(e) {
        if (recordingKeys) {
            e.preventDefault();
            
            // Don't record if only modifier key is pressed
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
                return;
            }
            
            currentKeyCombination = [];
            
            // Add modifiers first
            if (e.ctrlKey) currentKeyCombination.push('Ctrl');
            if (e.shiftKey) currentKeyCombination.push('Shift');
            if (e.altKey) currentKeyCombination.push('Alt');
            
            // Add the main key
            currentKeyCombination.push(e.key.toUpperCase());
            
            // Update input
            const combination = currentKeyCombination.join('+');
            keyCombinationInput.value = combination;
            
            // Show clear button
            document.getElementById('clearKeyCombination').classList.remove('hidden');
            
            // Stop recording after a combination is recorded
            recordingKeys = false;
            keyCombinationInput.classList.remove('recording');
        }
    });

    // Handle click outside
    document.addEventListener('click', function(e) {
        if (recordingKeys && !keyCombinationInput.contains(e.target)) {
            recordingKeys = false;
            keyCombinationInput.classList.remove('recording');
            if (!keyCombinationInput.value || keyCombinationInput.value === 'Press your key combination...') {
                keyCombinationInput.value = '';
            }
        }
    });
});

// Add the toggle function
function toggleQuickActions() {
    const panel = document.getElementById('quickActionsPanel');
    const icon = document.getElementById('quickActionsIcon');
    quickActionsEnabled = !quickActionsEnabled;
    
    if (quickActionsEnabled) {
        panel.style.maxHeight = panel.scrollHeight + 'px';
        panel.style.opacity = '1';
        panel.style.marginBottom = '2rem';
        icon.style.transform = 'rotate(0deg)';
        updateQuickActions(); // Update content immediately when showing
    } else {
        panel.style.maxHeight = '0';
        panel.style.opacity = '0';
        panel.style.marginBottom = '0';
        icon.style.transform = 'rotate(-90deg)';
    }
}

// Add this to the initialization code at the bottom
// Initialize Quick Actions Panel state
document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('quickActionsPanel');
    const icon = document.getElementById('quickActionsIcon');
    
    // Set initial styles for closed state
    panel.style.maxHeight = '0';
    panel.style.opacity = '0';
    panel.style.marginBottom = '0';
    panel.style.overflow = 'hidden';
    icon.style.transform = 'rotate(-90deg)';
});

// Add these functions after the key recording initialization
async function saveShortcut() {
    const name = document.getElementById('shortcutNameInput').value.trim();
    const keyCombination = document.getElementById('keyCombinationInput').value.trim();
    const presetName = document.getElementById('presetSelect').value;
    
    if (!name || !keyCombination || !presetName) {
        showNotification('Please fill in all fields', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/shortcuts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                key_combination: keyCombination,
                preset_name: presetName
            })
        });
        
        if (response.ok) {
            showNotification('Shortcut added successfully', 'success');
            updateCustomShortcuts();
            closeShortcutModal();
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to add shortcut', 'error');
        }
    } catch (error) {
        console.error('Error adding shortcut:', error);
        showNotification('Failed to add shortcut', 'error');
    }
}

async function deleteShortcut(shortcutId) {
    shortcutToDelete = shortcutId;
    const modal = document.getElementById('deleteShortcutModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Add keyboard shortcut listener
document.addEventListener('keydown', async (e) => {
    // Don't trigger shortcuts while recording new ones
    if (recordingKeys) return;
    
    try {
        const response = await fetch('/api/shortcuts');
        const data = await response.json();
        
        for (const shortcut of data.shortcuts) {
            const keys = shortcut.key_combination.split('+');
            const modifiers = {
                ctrl: keys.includes('Ctrl') && e.ctrlKey,
                shift: keys.includes('Shift') && e.shiftKey,
                alt: keys.includes('Alt') && e.altKey
            };
            
            const mainKey = keys[keys.length - 1].toUpperCase();
            if (modifiers.ctrl === keys.includes('Ctrl') &&
                modifiers.shift === keys.includes('Shift') &&
                modifiers.alt === keys.includes('Alt') &&
                e.key.toUpperCase() === mainKey) {
                e.preventDefault();
                runPreset(shortcut.preset_name);
                break;
            }
        }
    } catch (error) {
        console.error('Error checking shortcuts:', error);
    }
});

// Add these functions before the DOMContentLoaded event listener
async function openSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) {
        showNotification('Settings modal not found', 'error');
        return;
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Show loading state
    const loadingElement = document.getElementById('settingsLoading');
    if (loadingElement) loadingElement.classList.remove('hidden');
    
    try {
        // Execute all settings updates in parallel but track their results individually
        const results = await Promise.allSettled([
            { name: 'Startup Status', promise: updateStartupToggle() },
            { name: 'Minimize to Tray', promise: updateMinimizeToTrayToggle() },
            { name: 'Auto Reconnect', promise: updateAutoReconnectToggle() },
            { name: 'Theme Settings', promise: updateThemeButtons() },
            { name: 'Steam Idle Path', promise: updateIdlePath() }
        ].map(async ({ name, promise }) => {
            try {
                await promise;
                return { name, success: true };
            } catch (error) {
                console.error(`Error loading ${name}:`, error);
                return { name, success: false, error: error.message };
            }
        }));

        // Check for any failures
        const failures = results
            .filter(result => result.status === 'fulfilled' && !result.value.success)
            .map(result => result.value.name);

        if (failures.length > 0) {
            showNotification(`Failed to load settings: ${failures.join(', ')}`, 'error');
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('Failed to load all settings', 'error');
    } finally {
        // Hide loading state
        if (loadingElement) loadingElement.classList.add('hidden');
    }
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

// Add event listeners for clicking outside modals to close them
document.addEventListener('DOMContentLoaded', function() {
    const settingsModal = document.getElementById('settingsModal');
    const libraryModal = document.getElementById('libraryModal');
    
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                closeSettings();
            }
        });
    }
    
    if (libraryModal) {
        libraryModal.addEventListener('click', (e) => {
            if (e.target === libraryModal) {
                closeLibrary();
            }
        });
    }
});

async function setTheme(theme) {
    try {
        // Save theme to settings
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ theme })
        });

        if (response.ok) {
            applyTheme(theme);
            updateThemeButtons();
        }
    } catch (error) {
        console.error('Error saving theme:', error);
        showNotification('Failed to save theme setting', 'error');
    }
}

async function updateThemeButtons() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        const currentTheme = settings.theme || 'dark';
        
        // Apply the saved theme
        applyTheme(currentTheme);
        
        // Update theme buttons
        const darkBtn = document.getElementById('darkThemeBtn');
        const lightBtn = document.getElementById('lightThemeBtn');
        
        darkBtn.classList.toggle('border-blue-500', currentTheme === 'dark');
        lightBtn.classList.toggle('border-blue-500', currentTheme === 'light');
        
        return true;
    } catch (error) {
        console.error('Error updating theme buttons:', error);
        return false;
    }
}

// Add this to your DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function() {
    // ... existing code ...
    await updateThemeButtons(); // This will load and apply the saved theme
    // ... rest of the existing code ...
});

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    currentTheme = theme;
    localStorage.setItem('theme', theme);
}

async function checkFirstTimeSetup() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        
        const modal = document.getElementById('welcomeConfigModal');
        if (!settings.setup_completed) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            
            // Reset the form state
            welcomeStartupEnabled = false;
            welcomeMinimizeEnabled = false;
            welcomeIdleExePath = null;
            
            // Reset UI elements
            document.getElementById('welcomeStartupToggle').classList.remove('bg-blue-500');
            document.getElementById('welcomeStartupToggle').classList.add('bg-gray-500');
            document.getElementById('welcomeStartupToggle').querySelector('span').classList.remove('translate-x-5');
            
            document.getElementById('welcomeMinimizeToggle').classList.remove('bg-blue-500');
            document.getElementById('welcomeMinimizeToggle').classList.add('bg-gray-500');
            document.getElementById('welcomeMinimizeToggle').querySelector('span').classList.remove('translate-x-5');
            
            document.getElementById('welcomeIdlePath').textContent = 'No file selected';
            document.getElementById('welcomeCompleteBtn').disabled = true;
        } else if (settings.idler_path) {
            // If setup is completed and we have a path, update the settings display
            welcomeIdleExePath = settings.idler_path;
            const pathElement = document.getElementById('currentIdlePath');
            if (pathElement) {
                pathElement.textContent = settings.idler_path;
                pathElement.classList.remove('text-gray-500');
                pathElement.classList.add('text-green-500');
            }
        }
    } catch (error) {
        console.error('Error checking setup status:', error);
        showNotification('Failed to check setup status', 'error');
    }
}

async function selectIdleExe() {
    try {
        const response = await fetch('/api/reconfigure-idle', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            welcomeIdleExePath = data.path;
            
            // Update both welcome modal and settings modal paths
            const welcomePathElement = document.getElementById('welcomeIdlePath');
            const currentPathElement = document.getElementById('currentIdlePath');
            
            if (welcomePathElement) {
                welcomePathElement.textContent = data.path;
                welcomePathElement.classList.remove('text-gray-500');
                welcomePathElement.classList.add('text-green-500');
            }
            
            if (currentPathElement) {
                currentPathElement.textContent = data.path;
                currentPathElement.classList.remove('text-gray-500');
                currentPathElement.classList.add('text-green-500');
            }
            
            // Enable the complete setup button in welcome modal
            const completeBtn = document.getElementById('welcomeCompleteBtn');
            if (completeBtn) {
                completeBtn.disabled = false;
            }
            
            showNotification('Steam Idle location updated successfully', 'success');
        } else {
            welcomeIdleExePath = null;
            
            // Reset path displays
            const welcomePathElement = document.getElementById('welcomeIdlePath');
            const currentPathElement = document.getElementById('currentIdlePath');
            
            if (welcomePathElement) {
                welcomePathElement.textContent = 'No file selected';
                welcomePathElement.classList.remove('text-green-500');
                welcomePathElement.classList.add('text-gray-500');
            }
            
            if (currentPathElement) {
                currentPathElement.textContent = 'Not configured';
                currentPathElement.classList.remove('text-green-500');
                currentPathElement.classList.add('text-gray-500');
            }
            
            // Disable the complete setup button
            const completeBtn = document.getElementById('welcomeCompleteBtn');
            if (completeBtn) {
                completeBtn.disabled = true;
            }
            
            showNotification(data.message || 'Failed to update Steam Idle location', 'error');
        }
    } catch (error) {
        console.error('Error selecting idle executable:', error);
        showNotification('Failed to select Steam Idle executable', 'error');
    }
}

// Rename Preset Functions
function showRenamePresetModal(presetName) {
    presetToRename = presetName;
    const modal = document.getElementById('renamePresetModal');
    const currentNameSpan = document.getElementById('currentPresetName');
    const newNameInput = document.getElementById('newPresetName');
    
    currentNameSpan.textContent = presetName;
    newNameInput.value = presetName;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeRenamePresetModal() {
    const modal = document.getElementById('renamePresetModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    presetToRename = null;
}

async function confirmRenamePreset() {
    if (!presetToRename) return;
    
    const newName = document.getElementById('newPresetName').value.trim();
    if (!newName) {
        showNotification('Please enter a new name', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/rename-preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                oldName: presetToRename,
                newName: newName
            })
        });
        
        if (response.ok) {
            showNotification(`Preset renamed to "${newName}"`, 'success');
            updatePresetsList(await loadPresets(true));
            updateFavoritePresets();
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to rename preset', 'error');
        }
    } catch (error) {
        console.error('Error renaming preset:', error);
        showNotification('Failed to rename preset', 'error');
    }
    
    closeRenamePresetModal();
}

// Edit Preset Functions
async function showEditPresetModal(presetName) {
    presetToEdit = presetName;
    const modal = document.getElementById('editPresetModal');
    const nameSpan = document.getElementById('editPresetName');
    const gamesList = document.getElementById('editPresetCurrentGames');
    
    nameSpan.textContent = presetName;
    
    // Get the preset data
    const presets = await loadPresets(true);
    const preset = presets.find(p => p.name === presetName);
    
    if (preset) {
        editedGames = [...preset.games];
        updateEditPresetGamesList();
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEditPresetModal() {
    const modal = document.getElementById('editPresetModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    presetToEdit = null;
    editedGames = [];
}

function updateEditPresetGamesList() {
    const gamesList = document.getElementById('editPresetCurrentGames');
    gamesList.innerHTML = editedGames.map(game => `
        <div class="flex items-center justify-between bg-gray-700 p-4 rounded">
            <div class="flex items-center gap-4">
                <img src="${game.image}" alt="${game.name}" class="w-12 h-12 rounded">
                <div>
                    <div class="text-lg font-medium">${game.name}</div>
                    <div class="text-sm text-gray-400">ID: ${game.id}</div>
                </div>
            </div>
            <button onclick="removeGameFromPreset('${game.id}')" 
                    class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded text-sm font-medium transition-colors">
                <i class="fas fa-times mr-1"></i>Remove
            </button>
        </div>
    `).join('');
}

async function addGameToPreset() {
    const gameId = document.getElementById('editPresetGameId').value.trim();
    if (!gameId) {
        showNotification('Please input game ID or Name', 'error');
        return;
    }
    
    if (editedGames.some(game => game.id === gameId)) {
        showNotification('This game is already in the preset', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/fetch-game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId })
        });
        
        const gameInfo = await response.json();
        editedGames.push(gameInfo);
        updateEditPresetGamesList();
        document.getElementById('editPresetGameId').value = '';
    } catch (error) {
        console.error('Error fetching game:', error);
        showNotification('Failed to fetch game info', 'error');
    }
}

function removeGameFromPreset(gameId) {
    editedGames = editedGames.filter(game => game.id !== gameId);
    updateEditPresetGamesList();
}

async function saveEditedPreset() {
    if (!presetToEdit || editedGames.length === 0) {
        showNotification('Please add at least one game', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/save-preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: presetToEdit,
                games: editedGames
            })
        });
        
        if (response.ok) {
            showNotification('Preset updated successfully', 'success');
            updatePresetsList(await loadPresets(true));
            closeEditPresetModal();
        } else {
            showNotification('Failed to update preset', 'error');
        }
    } catch (error) {
        console.error('Error saving preset:', error);
        showNotification('Failed to update preset', 'error');
    }
}

// Add event listener for the edit preset game ID input
document.addEventListener('DOMContentLoaded', function() {
    const editPresetGameId = document.getElementById('editPresetGameId');
    if (editPresetGameId) {
        editPresetGameId.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') addGameToPreset();
        });
    }
});

async function reconfigureIdlePath() {
    try {
        const response = await fetch('/api/reconfigure-idle', {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (data.status === 'success') {
            // Update the displayed path
            const pathElement = document.getElementById('currentIdlePath');
            pathElement.textContent = data.path;
            pathElement.classList.remove('text-gray-500');
            pathElement.classList.add('text-green-500');
            showNotification('Steam Idle location updated successfully', 'success');
        } else {
            showNotification(data.message || 'Failed to update Steam Idle location', 'error');
        }
    } catch (error) {
        console.error('Error updating idle path:', error);
        showNotification('Failed to update Steam Idle location', 'error');
    }
}

async function updateIdlePath() {
    try {
        const response = await fetch('/api/get-idle-path');
        const data = await response.json();
        const pathElement = document.getElementById('currentIdlePath');
        
        if (data.path) {
            pathElement.textContent = data.path;
            pathElement.classList.remove('text-gray-500');
            pathElement.classList.add('text-green-500');
        } else {
            pathElement.textContent = 'Not configured';
            pathElement.classList.remove('text-green-500');
            pathElement.classList.add('text-gray-500');
        }
    } catch (error) {
        console.error('Error getting idle path:', error);
        const pathElement = document.getElementById('currentIdlePath');
        pathElement.textContent = 'Error loading path';
        pathElement.classList.remove('text-green-500');
        pathElement.classList.add('text-red-500');
    }
}

async function updateStartupToggle() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        const toggle = document.getElementById('startupToggle');
        
        if (settings.run_on_startup) {
            toggle.classList.add('bg-blue-500');
            toggle.classList.remove('bg-gray-500');
            toggle.querySelector('span:last-child').classList.add('translate-x-5');
        } else {
            toggle.classList.add('bg-gray-500');
            toggle.classList.remove('bg-blue-500');
            toggle.querySelector('span:last-child').classList.remove('translate-x-5');
        }
        return true;
    } catch (error) {
        console.error('Error updating startup toggle:', error);
        return false;
    }
}

async function toggleStartup() {
    try {
        const toggle = document.getElementById('startupToggle');
        const isEnabled = toggle.classList.contains('bg-blue-500');
        
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                run_on_startup: !isEnabled
            })
        });
        
        if (response.ok) {
            showNotification(`Run on startup ${!isEnabled ? 'enabled' : 'disabled'}`, 'success');
            await updateStartupToggle();
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to update startup setting', 'error');
        }
    } catch (error) {
        console.error('Error toggling startup:', error);
        showNotification('Failed to update startup setting', 'error');
    }
}

async function updateMinimizeToTrayToggle() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        const toggle = document.getElementById('minimizeToTrayToggle');
        
        if (settings.minimize_to_tray) {
            toggle.classList.add('bg-blue-500');
            toggle.classList.remove('bg-gray-500');
            toggle.querySelector('span:last-child').classList.add('translate-x-5');
        } else {
            toggle.classList.add('bg-gray-500');
            toggle.classList.remove('bg-blue-500');
            toggle.querySelector('span:last-child').classList.remove('translate-x-5');
        }
        return true;
    } catch (error) {
        console.error('Error updating minimize to tray toggle:', error);
        return false;
    }
}

async function toggleMinimizeToTray() {
    try {
        const toggle = document.getElementById('minimizeToTrayToggle');
        const isEnabled = toggle.classList.contains('bg-blue-500');
        
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                minimize_to_tray: !isEnabled
            })
        });
        
        if (response.ok) {
            showNotification(`Minimize to tray ${!isEnabled ? 'enabled' : 'disabled'}`, 'success');
            await updateMinimizeToTrayToggle();
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to update minimize to tray setting', 'error');
        }
    } catch (error) {
        console.error('Error toggling minimize to tray:', error);
        showNotification('Failed to update minimize to tray setting', 'error');
    }
}

async function updateAutoReconnectToggle() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        const toggle = document.getElementById('autoReconnectToggle');
        
        if (settings.auto_reconnect) {
            toggle.classList.add('bg-blue-500');
            toggle.classList.remove('bg-gray-500');
            toggle.querySelector('span:last-child').classList.add('translate-x-5');
        } else {
            toggle.classList.add('bg-gray-500');
            toggle.classList.remove('bg-blue-500');
            toggle.querySelector('span:last-child').classList.remove('translate-x-5');
        }
        return true;
    } catch (error) {
        console.error('Error updating auto reconnect toggle:', error);
        return false;
    }
}

async function toggleAutoReconnect() {
    try {
        const toggle = document.getElementById('autoReconnectToggle');
        const isEnabled = toggle.classList.contains('bg-blue-500');
        
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                auto_reconnect: !isEnabled
            })
        });
        
        if (response.ok) {
            showNotification(`Auto reconnect ${!isEnabled ? 'enabled' : 'disabled'}`, 'success');
            await updateAutoReconnectToggle();
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to update auto reconnect setting', 'error');
        }
    } catch (error) {
        console.error('Error toggling auto reconnect:', error);
        showNotification('Failed to update auto reconnect setting', 'error');
    }
}

async function exportStats() {
    try {
        const response = await fetch('/api/export-stats', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ type: 'csv' })
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `steam_idle_stats_${new Date().toISOString().slice(0,10)}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            a.remove();
            showNotification('success', 'Statistics exported successfully');
        } else {
            throw new Error('Failed to export statistics');
        }
    } catch (error) {
        console.error('Error exporting stats:', error);
        showNotification('error', 'Failed to export statistics');
    }
}

function confirmResetStats() {
    document.getElementById('resetStatsModal').classList.remove('hidden');
    document.getElementById('resetStatsModal').classList.add('flex');
}

function closeResetStatsModal() {
    document.getElementById('resetStatsModal').classList.add('hidden');
    document.getElementById('resetStatsModal').classList.remove('flex');
}

async function resetStats() {
    try {
        const response = await fetch('/api/stats/reset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            showNotification('success', 'Statistics reset successfully');
            closeResetStatsModal();
            updateStatistics(); // Refresh the statistics display
        } else {
            throw new Error('Failed to reset statistics');
        }
    } catch (error) {
        console.error('Error resetting stats:', error);
        showNotification('error', 'Failed to reset statistics');
    }
}

function openScheduleModal() {
    document.getElementById('scheduleModal').classList.remove('hidden');
    document.getElementById('scheduleModal').classList.add('flex');
    loadSchedules();
    loadPresetOptions();
}

function closeScheduleModal() {
    document.getElementById('scheduleModal').classList.add('hidden');
    document.getElementById('scheduleModal').classList.remove('flex');
}

async function loadSchedules() {
    try {
        const response = await fetch('/api/schedules');
        const data = await response.json();
        const schedulesList = document.getElementById('schedulesList');
        schedulesList.innerHTML = '';
        
        data.schedules.forEach(schedule => {
            const scheduleItem = document.createElement('div');
            scheduleItem.className = 'bg-gray-700 p-4 rounded mb-4';
            scheduleItem.innerHTML = `
                <div class="flex justify-between items-center">
                    <div>
                        <h4 class="font-medium">${schedule.name}</h4>
                        <p class="text-sm text-gray-400">Preset: ${schedule.preset_name}</p>
                        <p class="text-sm text-gray-400">Time: ${schedule.start_time} - ${schedule.end_time}</p>
                        <p class="text-sm text-gray-400">Days: ${schedule.days.join(', ')}</p>
                    </div>
                    <button onclick="deleteSchedule('${schedule.id}')" class="text-red-500 hover:text-red-600">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            schedulesList.appendChild(scheduleItem);
        });
    } catch (error) {
        console.error('Error loading schedules:', error);
        showNotification('error', 'Failed to load schedules');
    }
}

async function addSchedule(event) {
    event.preventDefault();
    
    const formData = new FormData(event.target);
    const data = {
        name: formData.get('scheduleName'),
        preset_name: formData.get('presetName'),
        start_time: formData.get('startTime'),
        end_time: formData.get('endTime'),
        days: Array.from(formData.getAll('days'))
    };
    
    try {
        const response = await fetch('/api/schedules', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        
        if (response.ok) {
            showNotification('success', 'Schedule added successfully');
            event.target.reset();
            loadSchedules();
        } else {
            throw new Error('Failed to add schedule');
        }
    } catch (error) {
        console.error('Error adding schedule:', error);
        showNotification('error', 'Failed to add schedule');
    }
}

async function deleteSchedule(scheduleId) {
    if (!confirm('Are you sure you want to delete this schedule?')) {
        return;
    }
    
    try {
        const response = await fetch('/api/schedules', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ id: scheduleId })
        });
        
        if (response.ok) {
            showNotification('success', 'Schedule deleted successfully');
            loadSchedules();
        } else {
            throw new Error('Failed to delete schedule');
        }
    } catch (error) {
        console.error('Error deleting schedule:', error);
        showNotification('error', 'Failed to delete schedule');
    }
}

async function loadPresetOptions() {
    try {
        const presetSelect = document.getElementById('presetSelect');
        if (!presetSelect) return;

        // Clear existing options
        presetSelect.innerHTML = '<option value="">Select a preset</option>';

        // Load presets
        const presets = await loadPresets(true);
        
        // Add preset options
        presets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.name;
            option.textContent = preset.name;
            presetSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading preset options:', error);
        showNotification('Failed to load presets', 'error');
    }
}

function addShortcut() {
    // Get the shortcut modal
    const modal = document.getElementById('shortcutModal');
    if (!modal) return;

    // Reset form fields
    document.getElementById('shortcutNameInput').value = '';
    document.getElementById('keyCombinationInput').value = '';
    const presetSelect = document.getElementById('presetSelect');
    if (presetSelect) {
        presetSelect.selectedIndex = 0;
    }

    // Load presets into the select dropdown
    loadPresetOptions();

    // Show the modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Add event listener for key combination input
document.addEventListener('DOMContentLoaded', function() {
    const keyCombinationInput = document.getElementById('keyCombinationInput');
    if (keyCombinationInput) {
        keyCombinationInput.addEventListener('focus', function() {
            this.classList.add('recording');
            this.value = '';
            
            const clearButton = document.getElementById('clearKeyCombination');
            if (clearButton) {
                clearButton.classList.remove('hidden');
            }
        });

        keyCombinationInput.addEventListener('keydown', function(e) {
            e.preventDefault();
            
            const keys = [];
            if (e.ctrlKey) keys.push('Ctrl');
            if (e.altKey) keys.push('Alt');
            if (e.shiftKey) keys.push('Shift');
            
            // Add the key if it's not a modifier
            if (!['Control', 'Alt', 'Shift'].includes(e.key)) {
                keys.push(e.key.toUpperCase());
            }
            
            this.value = keys.join(' + ');
        });

        keyCombinationInput.addEventListener('blur', function() {
            this.classList.remove('recording');
        });
    }
});

async function completeWelcomeSetup() {
    try {
        // Save all settings
        const settings = {
            run_on_startup: welcomeStartupEnabled,
            minimize_to_tray: welcomeMinimizeEnabled,
            setup_completed: true,
            idler_path: welcomeIdleExePath
        };

        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        if (response.ok) {
            // Close the welcome modal
            const modal = document.getElementById('welcomeConfigModal');
            modal.classList.remove('flex');
            modal.classList.add('hidden');
            
            // Update the settings display
            const pathElement = document.getElementById('currentIdlePath');
            if (pathElement) {
                pathElement.textContent = welcomeIdleExePath;
                pathElement.classList.remove('text-gray-500');
                pathElement.classList.add('text-green-500');
            }
            
            // Show success notification
            showNotification('Setup completed successfully', 'success');
            
            // Update startup and minimize toggles in settings
            await updateStartupToggle();
            await updateMinimizeToTrayToggle();
        } else {
            showNotification('Failed to save settings', 'error');
        }
    } catch (error) {
        console.error('Error completing setup:', error);
        showNotification('Failed to complete setup', 'error');
    }
}

// Add to the existing JavaScript code

let selectedLibraryGames = new Set();
let libraryGames = [];
let currentFilter = 'all';
let searchQuery = '';

async function loadSteamLibrary() {
    const modal = document.getElementById('libraryModal');
    if (!modal) {
        showNotification('Library modal not found', 'error');
        return;
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    try {
        const response = await fetch('/api/steam-library');
        const data = await response.json();
        
        if (data.error) {
            showNotification(data.error, 'error');
            return;
        }
        
        libraryGames = data.games;
        updateLibraryDisplay();
    } catch (error) {
        showNotification('Error loading Steam library: ' + error, 'error');
    }
}

function closeLibrary() {
    const modal = document.getElementById('libraryModal');
    if (!modal) return;
    
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    clearLibrarySelection();
}

async function openSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) {
        showNotification('Settings modal not found', 'error');
        return;
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Show loading state
    const loadingElement = document.getElementById('settingsLoading');
    if (loadingElement) loadingElement.classList.remove('hidden');
    
    try {
        // Execute all settings updates in parallel but track their results individually
        const results = await Promise.allSettled([
            { name: 'Startup Status', promise: updateStartupToggle() },
            { name: 'Minimize to Tray', promise: updateMinimizeToTrayToggle() },
            { name: 'Auto Reconnect', promise: updateAutoReconnectToggle() },
            { name: 'Theme Settings', promise: updateThemeButtons() },
            { name: 'Steam Idle Path', promise: updateIdlePath() }
        ].map(async ({ name, promise }) => {
            try {
                await promise;
                return { name, success: true };
            } catch (error) {
                console.error(`Error loading ${name}:`, error);
                return { name, success: false, error: error.message };
            }
        }));

        // Check for any failures
        const failures = results
            .filter(result => result.status === 'fulfilled' && !result.value.success)
            .map(result => result.value.name);

        if (failures.length > 0) {
            showNotification(`Failed to load settings: ${failures.join(', ')}`, 'error');
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('Failed to load all settings', 'error');
    } finally {
        // Hide loading state
        if (loadingElement) loadingElement.classList.add('hidden');
    }
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    if (!modal) return;
    
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

// Add event listeners for clicking outside modals to close them
document.addEventListener('DOMContentLoaded', function() {
    const settingsModal = document.getElementById('settingsModal');
    const libraryModal = document.getElementById('libraryModal');
    
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                closeSettings();
            }
        });
    }
    
    if (libraryModal) {
        libraryModal.addEventListener('click', (e) => {
            if (e.target === libraryModal) {
                closeLibrary();
            }
        });
    }
});

function updateLibraryDisplay() {
    const libraryDiv = document.getElementById('steamLibrary');
    libraryDiv.innerHTML = '';
    
    // Set view size class
    libraryDiv.className = `${currentViewSize}-view p-6`;
    
    // Filter games based on current filter and search
    const filteredGames = libraryGames.filter(game => {
        const matchesFilter = 
            currentFilter === 'all' ||
            (currentFilter === 'installed' && game.installed === true);
            
        const matchesSearch = 
            !searchQuery ||
            game.name.toLowerCase().includes(searchQuery.toLowerCase());
            
        return matchesFilter && matchesSearch;
    });

    // Update game counter display
    const totalGames = libraryGames.length;
    const installedGames = libraryGames.filter(game => game.installed === true).length;
    const filteredCount = filteredGames.length;
    const gameCountDisplay = document.getElementById('gameCountDisplay');
    if (gameCountDisplay) {
        if (searchQuery) {
            gameCountDisplay.textContent = `(${totalGames} total • ${installedGames} installed • ${filteredCount} matches)`;
        } else {
            gameCountDisplay.textContent = `(${totalGames} total • ${installedGames} installed)`;
        }
    }

    // Continue with existing game cards display
    filteredGames.forEach(game => {
        const isRunning = runningGames.has(game.id.toString());
        const gameCard = document.createElement('div');
        gameCard.className = `game-card ${currentViewSize}-card`;
        
        // Convert Steam minutes to hours and round to 1 decimal place
        const steamHours = (game.playtime_forever / 60).toFixed(1);
        
        gameCard.innerHTML = `
            <div class="relative">
                <img src="${game.icon || 'path/to/default-image.jpg'}" 
                     alt="${game.name}" 
                     class="w-full">
                <div class="absolute top-2 right-2 flex gap-2">
                    <input type="checkbox" id="game-${game.id}" 
                           class="w-5 h-5 rounded border-gray-600 text-blue-500 focus:ring-blue-500"
                           onchange="toggleGameSelection('${game.id}')"
                           ${selectedLibraryGames.has(game.id) ? 'checked' : ''}>
                </div>
                ${game.installed ? 
                    '<span class="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded text-xs">Installed</span>' :
                    '<span class="absolute top-2 left-2 bg-gray-500 text-white px-2 py-1 rounded text-xs">Not Installed</span>'
                }
            </div>
            <div class="p-4">
                <h3 class="text-lg font-semibold mb-2 truncate" title="${game.name}">${game.name}</h3>
                <div class="text-sm text-gray-400 mb-3">
                    <p>ID: ${game.id}</p>
                    <div class="flex justify-between items-center">
                        <p>Steam Hours: ${steamHours}</p>
                        <p>Idle Hours: ${game.hours || '0'}</p>
                    </div>
                    ${game.last_played ? `<p>Last played: ${new Date(game.last_played * 1000).toLocaleDateString()}</p>` : ''}
                </div>
                <div class="flex gap-2">
                    ${game.installed ? `
                        <button onclick="${isRunning ? 'stopGame' : 'startGame'}('${game.id}')" 
                                class="bg-${isRunning ? 'red' : 'blue'}-500 hover:bg-${isRunning ? 'red' : 'blue'}-600 px-4 py-2 rounded text-sm flex-1 transition-colors">
                            <i class="fas fa-${isRunning ? 'stop' : 'play'} mr-2"></i>${isRunning ? 'Stop' : 'Start'}
                        </button>
                    ` : ''}
                    <button onclick="addGameToNewPreset('${game.id}')" 
                            class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded text-sm flex-1 transition-colors">
                        <i class="fas fa-plus mr-2"></i>Add to Preset
                    </button>
                </div>
            </div>
        `;
        libraryDiv.appendChild(gameCard);
    });

    // Update filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-blue-500', 'text-white');
        btn.classList.add('text-gray-400', 'hover:text-white');
    });
    const activeFilter = document.getElementById(`filter${currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1)}`);
    if (activeFilter) {
        activeFilter.classList.add('active', 'bg-blue-500', 'text-white');
        activeFilter.classList.remove('text-gray-400', 'hover:text-white');
    }

    // Update view size buttons
    document.querySelectorAll('.view-size-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.classList.add('text-gray-400');
    });
    const activeViewBtn = document.getElementById(`view${currentViewSize.charAt(0).toUpperCase() + currentViewSize.slice(1)}`);
    if (activeViewBtn) {
        activeViewBtn.classList.add('active');
        activeViewBtn.classList.remove('text-gray-400');
    }
}

function setViewSize(size) {
    currentViewSize = size;
    localStorage.setItem('libraryViewSize', size);
    updateLibraryDisplay();
}

function toggleFilter(filter) {
    currentFilter = filter;
    
    // Remove active class from all filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active', 'bg-blue-500', 'text-white');
        btn.classList.add('text-gray-400', 'hover:text-white');
    });
    
    // Add active class to clicked filter button
    const activeFilter = document.getElementById(`filter${filter.charAt(0).toUpperCase() + filter.slice(1)}`);
    if (activeFilter) {
        activeFilter.classList.add('active', 'bg-blue-500', 'text-white');
        activeFilter.classList.remove('text-gray-400', 'hover:text-white');
    }
    
    // Update the library display
    updateLibraryDisplay();
}

// Add event listener for search input
document.getElementById('librarySearch').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    updateLibraryDisplay();
});

function refreshLibrary() {
    clearLibrarySelection();
    loadSteamLibrary();
}

// Update existing functions
function toggleGameSelection(gameId) {
    if (selectedLibraryGames.has(gameId)) {
        selectedLibraryGames.delete(gameId);
    } else {
        selectedLibraryGames.add(gameId);
    }
    
    const actionsDiv = document.getElementById('libraryActions');
    const selectedCount = document.getElementById('selectedGamesCount');
    
    if (selectedCount) {
        selectedCount.textContent = selectedLibraryGames.size;
    }
    
    actionsDiv.classList.toggle('hidden', selectedLibraryGames.size === 0);
}

function clearLibrarySelection() {
    selectedLibraryGames.clear();
    const actionsDiv = document.getElementById('libraryActions');
    const selectedCount = document.getElementById('selectedGamesCount');
    
    if (selectedCount) {
        selectedCount.textContent = '0';
    }
    
    if (actionsDiv) {
        actionsDiv.classList.add('hidden');
    }
}

// Add to window.onload
window.onload = function() {
    // ... existing onload code ...
    loadSteamLibrary();
}; 

// Add modal HTML when document loads
window.onload = function() {
    // ... existing onload code ...
    
    // Create library modal
    const modal = document.createElement('div');
    modal.id = 'libraryModal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg">
            <!-- Header -->
            <div class="header p-6 border-b border-gray-700">
                <div class="flex justify-between items-center">
                    <div class="flex flex-col gap-2">
                        <h2 class="text-2xl font-semibold">Steam Library</h2>
                        <div id="gameCountDisplay" class="text-gray-400 text-sm">
                            <i class="fas fa-gamepad mr-2"></i>Loading games...
                        </div>
                        <div class="flex gap-2 mt-2">
                            <button onclick="toggleFilter('all')" id="filterAll" 
                                    class="filter-btn active px-3 py-1 rounded text-sm">
                                All Games
                            </button>
                            <button onclick="toggleFilter('installed')" id="filterInstalled" 
                                    class="filter-btn px-3 py-1 rounded text-sm">
                                Installed
                            </button>
                        </div>
                    </div>
                    <div class="flex items-center gap-4">
                        <!-- View Size Controls -->
                        <div class="flex items-center gap-2 border-r border-gray-600 pr-4">
                            <button onclick="setViewSize('compact')" id="viewCompact" 
                                    class="view-size-btn text-gray-400 hover:text-white transition-colors" title="Compact View">
                                <i class="fas fa-th text-lg"></i>
                            </button>
                            <button onclick="setViewSize('normal')" id="viewNormal" 
                                    class="view-size-btn text-blue-500 hover:text-white transition-colors" title="Normal View">
                                <i class="fas fa-th-large text-lg"></i>
                            </button>
                            <button onclick="setViewSize('large')" id="viewLarge" 
                                    class="view-size-btn text-gray-400 hover:text-white transition-colors" title="Large View">
                                <i class="fas fa-square text-lg"></i>
                            </button>
                        </div>
                        <div class="relative">
                            <input type="text" id="librarySearch" placeholder="Search games..." 
                                   class="bg-gray-700 rounded px-4 py-2 pl-10 focus:outline-none focus:ring-2 focus:ring-blue-500">
                            <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                        </div>
                        <button onclick="refreshLibrary()" class="text-gray-400 hover:text-white transition-colors">
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button onclick="closeLibrary()" class="text-gray-400 hover:text-white transition-colors">
                            <i class="fas fa-times text-xl"></i>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Games Grid with Scrollbar -->
            <div class="flex-1 overflow-y-auto custom-scrollbar" style="max-height: calc(90vh - 180px);">
                <div id="steamLibrary" class="p-6">
                    <!-- Steam library games will be added here dynamically -->
                </div>
            </div>

            <!-- Footer Actions -->
            <div id="libraryActions" class="hidden p-4 border-t border-gray-700">
                <div class="flex justify-between items-center">
                    <span class="text-gray-400">
                        <span id="selectedGamesCount">0</span> games selected
                    </span>
                    <div class="flex gap-4">
                        <button onclick="createPresetFromSelected()" 
                                class="bg-green-500 hover:bg-green-600 px-6 py-2 rounded font-semibold transition-colors">
                            <i class="fas fa-plus mr-2"></i>Create Preset from Selected
                        </button>
                        <button onclick="startSelectedGames()" 
                                class="bg-blue-500 hover:bg-blue-600 px-6 py-2 rounded font-semibold transition-colors">
                            <i class="fas fa-play mr-2"></i>Start Selected Games
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    
    loadSteamLibrary();
};

// ... rest of the existing code ...

// Add function to handle adding a game to a new preset
async function addGameToNewPreset(gameId) {
    const game = libraryGames.find(g => g.id.toString() === gameId.toString());
    if (!game) return;
    
    // Add to current games list
    if (!currentGames.some(g => g.id === game.id)) {
        currentGames.push(game);
    }
    
    // Show save preset modal
    showSavePresetModal();
    showNotification('Game added to new preset. Please enter a name for the preset.', 'info');
}

// Add function to create preset from selected games
async function createPresetFromSelected() {
    if (selectedLibraryGames.size === 0) {
        showNotification('Please select games first', 'error');
        return;
    }
    
    // Get selected games info
    const selectedGames = libraryGames.filter(game => selectedLibraryGames.has(game.id));
    currentGames = selectedGames;
    
    // Show save preset modal
    showSavePresetModal();
    showNotification(`${selectedGames.length} games added to new preset. Please enter a name for the preset.`, 'info');
}

// Add function to start selected games
async function startSelectedGames() {
    if (selectedLibraryGames.size === 0) {
        showNotification('Please select games first', 'error');
        return;
    }
    
    // Check Steam status first
    const steamStatus = await updateSteamStatus();
    if (!steamStatus) {
        showNotification('Unable to check Steam status', 'error');
        return;
    }
    
    if (!steamStatus.running) {
        showSteamLaunchModal();
        return;
    }
    
    if (!steamStatus.online) {
        showNotification('Steam appears to be offline. Please ensure Steam is online.', 'error');
        return;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    // Start each selected game
    for (const gameId of selectedLibraryGames) {
        try {
            const response = await fetch('/api/start-game', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ gameId })
            });

            if (response.ok) {
                runningGames.add(gameId.toString());
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            console.error('Error starting game:', error);
            failCount++;
        }
    }
    
    // Update display
    updateLibraryDisplay();
    
    // Show result notification
    if (successCount > 0) {
        showNotification(`Successfully started ${successCount} games${failCount > 0 ? `, failed to start ${failCount} games` : ''}`, 
            failCount > 0 ? 'warning' : 'success');
    } else {
        showNotification('Failed to start any games', 'error');
    }
}

// Add this function to trigger the game state change event
function triggerGameStateChange() {
    document.dispatchEvent(new Event('gameStateChanged'));
}

// Add save preset modal functions
function showSavePresetModal() {
    const savePresetModal = document.getElementById('savePresetModal');
    if (!savePresetModal) {
        // Create modal if it doesn't exist
        const modalHtml = `
            <div id="savePresetModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-50">
                <div class="bg-gray-800 rounded-lg p-6 w-96">
                    <h3 class="text-xl font-semibold mb-4">Save Preset</h3>
                    <div class="mb-4">
                        <label for="savePresetNameInput" class="block text-sm font-medium mb-2">Preset Name</label>
                        <input type="text" id="savePresetNameInput" 
                               class="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 focus:outline-none focus:border-blue-500"
                               placeholder="Enter preset name">
                    </div>
                    <div class="flex justify-end gap-3">
                        <button onclick="closeSavePresetModal()" 
                                class="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded">
                            Cancel
                        </button>
                        <button onclick="confirmSavePreset()" 
                                class="px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded">
                            Save
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
    }

    const modalElement = document.getElementById('savePresetModal');
    modalElement.classList.remove('hidden');
    modalElement.classList.add('flex');
    
    // Focus the input
    document.getElementById('savePresetNameInput').focus();
}

function closeSavePresetModal() {
    const modalElement = document.getElementById('savePresetModal');
    if (modalElement) {
        modalElement.classList.remove('flex');
        modalElement.classList.add('hidden');
        document.getElementById('savePresetNameInput').value = '';
    }
}

async function confirmSavePreset() {
    const presetName = document.getElementById('savePresetNameInput').value.trim();
    
    if (!presetName) {
        showNotification('Please enter a preset name', 'error');
        return;
    }
    
    if (currentGames.length === 0) {
        showNotification('No games selected for the preset', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/save-preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: presetName,
                games: currentGames
            })
        });
        
        if (response.ok) {
            showNotification('Preset saved successfully', 'success');
            currentGames = []; // Clear current games
            closeSavePresetModal();
            loadPresets(); // Refresh presets list
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to save preset', 'error');
        }
    } catch (error) {
        console.error('Error saving preset:', error);
        showNotification('Failed to save preset', 'error');
    }
}

// Add event listener for the save preset name input
document.addEventListener('DOMContentLoaded', function() {
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeSavePresetModal();
        }
    });
    
    // Add click outside listener for save preset modal
    document.addEventListener('click', function(e) {
        const modal = document.getElementById('savePresetModal');
        if (modal && e.target === modal) {
            closeSavePresetModal();
        }
    });
});

// Add these functions after the existing updatePlaytimes function

function showRunningGames() {
    const modal = document.getElementById('runningGamesModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    updateRunningGamesList();
}

function closeRunningGames() {
    const modal = document.getElementById('runningGamesModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function updateRunningGamesList() {
    const gamesList = document.getElementById('runningGamesList');
    const modalCount = document.getElementById('runningGamesModalCount');
    const headerCount = document.getElementById('runningGamesCount');
    
    // Update counts
    const runningCount = runningGames.size;
    modalCount.textContent = `(${runningCount} ${runningCount === 1 ? 'game' : 'games'})`;
    
    // Update header badge
    if (runningCount > 0) {
        headerCount.textContent = runningCount;
        headerCount.classList.remove('hidden');
    } else {
        headerCount.classList.add('hidden');
    }
    
    // Clear the list and show loading state if there are games
    if (runningCount > 0) {
        gamesList.innerHTML = `
            <div class="text-center text-gray-400 py-4">
                <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
                <p>Loading ${runningCount} games...</p>
            </div>
        `;
    }
    
    // Prepare array to hold all game data
    const gamePromises = [];
    
    // Get playtime for each running game
    for (const gameId of runningGames) {
        const promise = (async () => {
            try {
                // Get game session time
                const timeResponse = await fetch('/api/game-session-time', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gameId })
                });
                const timeData = await timeResponse.json();
                
                // First try to find game info in currentGames
                let gameInfo = currentGames.find(g => g.id.toString() === gameId.toString());
                
                // If not found in currentGames, try to fetch it
                if (!gameInfo) {
                    const gameResponse = await fetch('/api/fetch-game', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ gameId })
                    });
                    gameInfo = await gameResponse.json();
                    
                    // Add to currentGames if not already there
                    if (gameInfo && !currentGames.some(g => g.id === gameInfo.id)) {
                        currentGames.push(gameInfo);
                    }
                }
                
                if (!gameInfo) return null;
                
                return {
                    gameInfo,
                    timeData,
                    gameId
                };
            } catch (error) {
                console.error('Error fetching game data:', error);
                return null;
            }
        })();
        
        gamePromises.push(promise);
    }
    
    // Wait for all game data to be fetched
    const gamesData = await Promise.all(gamePromises);
    
    // Clear the list again to remove loading state
    gamesList.innerHTML = '';
    
    // Filter out null results and sort games by name
    const validGamesData = gamesData.filter(data => data !== null)
        .sort((a, b) => a.gameInfo.name.localeCompare(b.gameInfo.name));
    
    // If no valid games are running, show a message
    if (validGamesData.length === 0) {
        gamesList.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <i class="fas fa-gamepad text-4xl mb-2"></i>
                <p>No games currently running</p>
            </div>
        `;
        return;
    }
    
    // Create and append all game cards
    validGamesData.forEach(({ gameInfo, timeData, gameId }) => {
        const gameCard = document.createElement('div');
        gameCard.className = 'bg-gray-700 rounded-lg p-4 flex items-center gap-4 mb-4 last:mb-0';
        gameCard.innerHTML = `
            <img src="${gameInfo.image || 'https://via.placeholder.com/460x215/374151/FFFFFF?text=No+Image'}" 
                 alt="${gameInfo.name}" 
                 class="w-16 h-16 rounded object-cover">
            <div class="flex-1 min-w-0">
                <h3 class="font-semibold text-lg truncate" title="${gameInfo.name}">${gameInfo.name}</h3>
                <div class="text-sm text-gray-400 truncate">ID: ${gameInfo.id}</div>
                <div class="mt-1">
                    <div class="text-green-400 text-sm">Session: ${timeData.current_session}</div>
                    <div class="text-blue-400 text-sm">Total: ${timeData.total_time}</div>
                </div>
            </div>
            <div class="flex gap-2 flex-shrink-0">
                <button onclick="stopGame('${gameId}')" 
                        class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded text-sm font-medium transition-colors">
                    <i class="fas fa-stop mr-1"></i>Stop
                </button>
            </div>
        `;
        gamesList.appendChild(gameCard);
    });
}

function showEmergencyStopConfirmation() {
    const modal = document.getElementById('emergencyStopConfirmModal');
    const messageElement = modal.querySelector('p');
    const runningGamesCount = runningGames.size;
    
    if (runningGamesCount === 0) {
        showNotification('No games are currently running', 'info');
        return;
    }
    
    // Update the confirmation message with the number of running games
    messageElement.textContent = `Are you sure you want to stop ${runningGamesCount} running ${runningGamesCount === 1 ? 'game' : 'games'}? This action cannot be undone.`;
    
    // Show the modal with animation
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Add animation to the modal content
    const modalContent = modal.querySelector('.bg-gray-800');
    modalContent.style.opacity = '0';
    modalContent.style.transform = 'scale(0.95)';
    
    // Trigger animation
    setTimeout(() => {
        modalContent.style.opacity = '1';
        modalContent.style.transform = 'scale(1)';
    }, 10);
}

function closeEmergencyStopConfirmation() {
    const modal = document.getElementById('emergencyStopConfirmModal');
    const modalContent = modal.querySelector('.bg-gray-800');
    
    // Animate out
    modalContent.style.opacity = '0';
    modalContent.style.transform = 'scale(0.95)';
    
    // Hide modal after animation
    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
        // Reset transform for next time
        modalContent.style.transform = 'scale(1)';
    }, 200);
}

async function confirmEmergencyStop() {
    try {
        closeEmergencyStopConfirmation();
        const response = await fetch('/api/emergency-stop');
        const data = await response.json();
        
        if (data.status === 'success') {
            runningGames.clear();
            updateGamesList();
            updatePresetsList(await loadPresets(true));
            updateRunningGamesList();
            showNotification(`Emergency stop successful - Stopped ${data.stopped_games.length} games`, 'success');
            closeRunningGames();
        } else {
            showNotification('Failed to stop games', 'error');
        }
    } catch (error) {
        console.error('Error during emergency stop:', error);
        showNotification('Failed to stop all games', 'error');
    }
}

// Add event listener for clicking outside the emergency stop modal
document.addEventListener('DOMContentLoaded', function() {
    const emergencyStopModal = document.getElementById('emergencyStopConfirmModal');
    if (emergencyStopModal) {
        emergencyStopModal.addEventListener('click', (e) => {
            if (e.target === emergencyStopModal) {
                closeEmergencyStopConfirmation();
            }
        });
    }
});