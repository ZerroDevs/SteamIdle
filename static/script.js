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
    const gameId = document.getElementById('gameId').value.trim();
    if (!gameId) return;

    try {
        const response = await fetch('/api/fetch-game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId })
        });

        const gameInfo = await response.json();
        addGameToList(gameInfo);
        document.getElementById('gameId').value = '';
    } catch (error) {
        console.error('Error fetching game:', error);
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
    const presetName = document.getElementById('presetName').value.trim();
    if (!presetName || currentGames.length === 0) {
        alert('Please enter a preset name and add at least one game!');
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
            document.getElementById('presetName').value = '';
            loadPresets();
        }
    } catch (error) {
        console.error('Error saving preset:', error);
    }
}

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
    presetsList.innerHTML = '';

    // Get favorites list
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
        
        const response = await fetch('/api/start-game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId })
        });

        const data = await response.json();
        if (response.ok) {
            runningGames.add(gameId);
            updateGamesList();
            updatePresetsList(await loadPresets(true));
            showNotification('Game started successfully', 'success');
        } else {
            showNotification(data.message || 'Failed to start game', 'error');
        }
    } catch (error) {
        console.error('Error starting game:', error);
        showNotification('Failed to start game', 'error');
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

        if (!response.ok) {
            throw new Error('Failed to stop game');
        }
        
        runningGames.delete(gameId);
        updateGamesList();
        updatePresetsList(await loadPresets(true));
        showNotification('Game stopped successfully', 'success');
    } catch (error) {
        console.error('Error stopping game:', error);
        showNotification('Failed to stop game', 'error');
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
    const reader = new FileReader();
    reader.onload = async (e) => {
        const content = e.target.result;
        const gameIds = content.match(/steam-idle\.exe\s+(\d+)/g)
            ?.map(match => match.match(/\d+/)[0]) || [];
        
        if (gameIds.length === 0) {
            alert('No valid game IDs found in the BAT file');
            return;
        }

        // Get preset name from file name (remove .bat extension)
        const presetName = file.name.replace('.bat', '');
        
        // Fetch info for each game
        const games = [];
        for (const gameId of gameIds) {
            const response = await fetch('/api/fetch-game', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ gameId })
            });

            const gameInfo = await response.json();
            games.push(gameInfo);
        }

        // Save as preset
        try {
            const response = await fetch('/api/save-preset', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: presetName,
                    games: games
                })
            });

            if (!response.ok) {
                throw new Error('Failed to save preset');
            }

            // Switch to presets tab and refresh list
            switchTab('presets');
            loadPresets();
        } catch (error) {
            console.error('Error saving preset:', error);
            alert('Failed to save preset');
        }
    };
    reader.readAsText(file);
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

        // Update UI
        updateGamesList();
        updatePresetsList(presets);
        
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

            // Add to running presets
            runningPresets.add(presetName);

            // Update UI
            updateGamesList();
            updatePresetsList(await loadPresets(true));
            
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
    const modal = document.getElementById('emergencyStopModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEmergencyStopModal() {
    const modal = document.getElementById('emergencyStopModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function confirmEmergencyStop() {
    try {
        const response = await fetch('/api/emergency-stop');
        const data = await response.json();
        
        if (data.status === 'success') {
            runningGames.clear();
            updateGamesList();
            updatePresetsList(await loadPresets(true));
            showNotification(`Emergency stop successful - Stopped ${data.stopped_games.length} games`, 'success');
        }
    } catch (error) {
        console.error('Error during emergency stop:', error);
        showNotification('Failed to stop all games', 'error');
    } finally {
        closeEmergencyStopModal();
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
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    // Show loading state
    const loadingElement = document.getElementById('settingsLoading');
    if (loadingElement) loadingElement.classList.remove('hidden');
    
    try {
        await Promise.all([
            updateStartupToggle(),
            updateMinimizeToTrayToggle(),
            updateAutoReconnectToggle(),
            updateThemeButtons(),
            updateIdlePath()
        ]);
    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('Failed to load some settings', 'error');
    } finally {
        // Hide loading state
        if (loadingElement) loadingElement.classList.add('hidden');
    }
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

// Add event listener for clicking outside the modal to close it
document.addEventListener('DOMContentLoaded', () => {
    const settingsModal = document.getElementById('settingsModal');
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettings();
        }
    });
});

function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeButtons();
}

function updateThemeButtons() {
    const darkBtn = document.getElementById('darkThemeBtn');
    const lightBtn = document.getElementById('lightThemeBtn');
    
    // Reset both buttons
    darkBtn.classList.remove('border-blue-500');
    lightBtn.classList.remove('border-blue-500');
    
    // Highlight active theme
    if (currentTheme === 'dark') {
        darkBtn.classList.add('border-blue-500');
    } else {
        lightBtn.classList.add('border-blue-500');
    }
}

// Add after the theme functions
async function updateStartupToggle() {
    try {
        const response = await fetch('/api/startup-status');
        const data = await response.json();
        const toggle = document.getElementById('startupToggle');
        
        if (data.enabled) {
            toggle.classList.add('bg-blue-500');
            toggle.classList.remove('bg-gray-500');
            toggle.querySelector('span:last-child').classList.add('translate-x-5');
        } else {
            toggle.classList.add('bg-gray-500');
            toggle.classList.remove('bg-blue-500');
            toggle.querySelector('span:last-child').classList.remove('translate-x-5');
        }
    } catch (error) {
        console.error('Error updating startup status:', error);
    }
}

async function toggleStartup() {
    try {
        const toggle = document.getElementById('startupToggle');
        const isEnabled = toggle.classList.contains('bg-blue-500');
        
        const response = await fetch('/api/startup-status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                enabled: !isEnabled
            })
        });
        
        if (response.ok) {
            showNotification(`Startup ${!isEnabled ? 'enabled' : 'disabled'}`, 'success');
            updateStartupToggle();
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to update startup status', 'error');
        }
    } catch (error) {
        console.error('Error toggling startup:', error);
        showNotification('Failed to update startup status', 'error');
    }
}

// Add after the startup toggle functions
async function updateMinimizeToTrayToggle() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        const toggle = document.getElementById('minimizeToTrayToggle');
        
        if (data.minimize_to_tray) {
            toggle.classList.add('bg-blue-500');
            toggle.classList.remove('bg-gray-500');
            toggle.querySelector('span:last-child').classList.add('translate-x-5');
        } else {
            toggle.classList.add('bg-gray-500');
            toggle.classList.remove('bg-blue-500');
            toggle.querySelector('span:last-child').classList.remove('translate-x-5');
        }
    } catch (error) {
        console.error('Error updating minimize to tray status:', error);
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
            updateMinimizeToTrayToggle();
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to update minimize to tray setting', 'error');
        }
    } catch (error) {
        console.error('Error toggling minimize to tray:', error);
        showNotification('Failed to update minimize to tray setting', 'error');
    }
}

// Add to the existing DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async function() {
    // Add this line to the existing DOMContentLoaded event listener
    await checkFirstTimeSetup();
    
    // ... rest of the existing code ...
});

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
            document.getElementById('welcomeMinimizeToggle').classList.remove('bg-blue-500');
            document.getElementById('welcomeMinimizeToggle').classList.add('bg-gray-500');
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
        const result = await response.json();
        
        if (response.ok) {
            await updateIdlePath();
            showNotification('Steam Idle location updated successfully', 'success');
        } else {
            showNotification(result.message || 'Failed to configure Steam Idle location', 'error');
        }
    } catch (error) {
        console.error('Error selecting idle exe:', error);
        showNotification('Failed to select steam-idle.exe', 'error');
    }
}

function toggleWelcomeStartup() {
    welcomeStartupEnabled = !welcomeStartupEnabled;
    const button = document.getElementById('welcomeStartupToggle');
    const label = button.nextElementSibling;
    
    button.classList.toggle('bg-blue-500', welcomeStartupEnabled);
    button.classList.toggle('bg-gray-500', !welcomeStartupEnabled);
    button.querySelector('span:last-child').classList.toggle('translate-x-5', welcomeStartupEnabled);
    
    label.classList.toggle('text-blue-500', welcomeStartupEnabled);
}

function toggleWelcomeMinimize() {
    welcomeMinimizeEnabled = !welcomeMinimizeEnabled;
    const button = document.getElementById('welcomeMinimizeToggle');
    const label = button.nextElementSibling;
    
    button.classList.toggle('bg-blue-500', welcomeMinimizeEnabled);
    button.classList.toggle('bg-gray-500', !welcomeMinimizeEnabled);
    button.querySelector('span:last-child').classList.toggle('translate-x-5', welcomeMinimizeEnabled);
    
    label.classList.toggle('text-blue-500', welcomeMinimizeEnabled);
}

async function completeWelcomeSetup() {
    if (!welcomeIdleExePath) {
        showNotification('Please select steam-idle.exe location', 'error');
        return;
    }

    try {
        const settings = {
            minimize_to_tray: welcomeMinimizeEnabled,
            setup_completed: true
        };

        // Save settings
        const settingsResponse = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        if (!settingsResponse.ok) {
            throw new Error('Failed to save settings');
        }

        // Configure startup if enabled
        if (welcomeStartupEnabled) {
            const startupResponse = await fetch('/api/startup-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled: true })
            });

            if (!startupResponse.ok) {
                throw new Error('Failed to configure startup');
            }
        }

        // Animate modal out
        const modal = document.getElementById('welcomeConfigModal');
        modal.style.animation = 'modalFadeOut 0.3s ease-out forwards';
        
        // Hide modal after animation
        setTimeout(() => {
            modal.classList.remove('flex');
            modal.classList.add('hidden');
            modal.style.animation = '';
        }, 300);
        
        showNotification('Setup completed successfully', 'success');
    } catch (error) {
        console.error('Error completing setup:', error);
        showNotification('Failed to complete setup', 'error');
    }
}

// Add fadeout animation to CSS
const style = document.createElement('style');
style.textContent = `
@keyframes modalFadeOut {
    from {
        opacity: 1;
        transform: scale(1);
    }
    to {
        opacity: 0;
        transform: scale(0.95);
    }
}
`;
document.head.appendChild(style);

// Initialize theme on page load
document.addEventListener('DOMContentLoaded', async function() {
    applyTheme(currentTheme);
    await checkFirstTimeSetup();
    updateThemeButtons();
    await updateSteamStatus();
    await loadPresets();
    await updateStatistics();
    await updateQuickActions();
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
            document.getElementById('welcomeMinimizeToggle').classList.remove('bg-blue-500');
            document.getElementById('welcomeMinimizeToggle').classList.add('bg-gray-500');
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
        const result = await response.json();
        
        if (result.status === 'success') {
            welcomeIdleExePath = result.path;
            document.getElementById('welcomeIdlePath').textContent = result.path;
            document.getElementById('welcomeCompleteBtn').disabled = false;
        } else {
            showNotification(result.message, 'error');
        }
    } catch (error) {
        console.error('Error selecting idle exe:', error);
        showNotification('Failed to select steam-idle.exe', 'error');
    }
}

function toggleWelcomeStartup() {
    welcomeStartupEnabled = !welcomeStartupEnabled;
    const button = document.getElementById('welcomeStartupToggle');
    button.classList.toggle('bg-blue-500', welcomeStartupEnabled);
    button.classList.toggle('bg-gray-500', !welcomeStartupEnabled);
}

function toggleWelcomeMinimize() {
    welcomeMinimizeEnabled = !welcomeMinimizeEnabled;
    const button = document.getElementById('welcomeMinimizeToggle');
    button.classList.toggle('bg-blue-500', welcomeMinimizeEnabled);
    button.classList.toggle('bg-gray-500', !welcomeMinimizeEnabled);
}

async function completeWelcomeSetup() {
    if (!welcomeIdleExePath) {
        showNotification('Please select steam-idle.exe location', 'error');
        return;
    }

    try {
        const settings = {
            minimize_to_tray: welcomeMinimizeEnabled,
            setup_completed: true
        };

        // Save settings
        await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        // Configure startup if enabled
        if (welcomeStartupEnabled) {
            await fetch('/api/startup-status', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ enabled: true })
            });
        }

        // Animate modal out
        const modal = document.getElementById('welcomeConfigModal');
        modal.style.animation = 'modalFadeOut 0.3s ease-out forwards';
        
        // Hide modal after animation
        setTimeout(() => {
            modal.style.display = 'none';
            modal.style.animation = '';
        }, 300);
        
        showNotification('Setup completed successfully', 'success');
    } catch (error) {
        console.error('Error completing setup:', error);
        showNotification('Failed to complete setup', 'error');
    }
}

async function updateIdlePath() {
    try {
        const response = await fetch('/api/get-idle-path');
        const data = await response.json();
        const pathElement = document.getElementById('currentIdlePath');
        if (pathElement) {
            if (data.path) {
                pathElement.textContent = data.path;
                pathElement.classList.remove('text-gray-500');
                pathElement.classList.add('text-green-500');
            } else {
                pathElement.textContent = 'Not configured';
                pathElement.classList.remove('text-green-500');
                pathElement.classList.add('text-gray-500');
            }
        }
    } catch (error) {
        console.error('Error updating idle path:', error);
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
        <div class="flex items-center justify-between bg-gray-700 p-2 rounded">
            <div class="flex items-center gap-2">
                <img src="${game.image}" alt="${game.name}" class="w-8 h-8 rounded">
                <div>
                    <div class="font-medium">${game.name}</div>
                    <div class="text-sm text-gray-400">ID: ${game.id}</div>
                </div>
            </div>
            <button onclick="removeGameFromPreset('${game.id}')" 
                    class="bg-red-500 hover:bg-red-600 px-3 py-1 rounded text-xs">
                <i class="fas fa-times mr-1"></i>Remove
            </button>
        </div>
    `).join('');
}

async function addGameToPreset() {
    const gameId = document.getElementById('editPresetGameId').value.trim();
    if (!gameId) {
        showNotification('Please enter a game ID', 'error');
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