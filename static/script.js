let currentGames = [];
let runningGames = new Set();
let runningPresets = new Set();

// Add status checking intervals
setInterval(updateGameStatuses, 5000); // Check every 5 seconds
setInterval(updatePlaytimes, 1000); // Update playtimes every second
setInterval(updateSteamStatus, 10000); // Check Steam status every 10 seconds

// Load settings on startup
loadSettings();

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        
        // Update minimize to tray checkbox and its visual state
        const minimizeToTrayCheckbox = document.getElementById('minimizeToTray');
        if (minimizeToTrayCheckbox) {
            minimizeToTrayCheckbox.checked = settings.minimize_to_tray;
            // Update the toggle appearance
            const toggleDiv = minimizeToTrayCheckbox.nextElementSibling;
            if (settings.minimize_to_tray) {
                toggleDiv.classList.add('bg-blue-500');
                toggleDiv.classList.remove('bg-gray-600');
            } else {
                toggleDiv.classList.remove('bg-blue-500');
                toggleDiv.classList.add('bg-gray-600');
            }
        }
    } catch (error) {
        console.error('Error loading settings:', error);
    }
}

async function updateSettings() {
    try {
        const minimizeToTrayCheckbox = document.getElementById('minimizeToTray');
        const settings = {
            minimize_to_tray: minimizeToTrayCheckbox.checked
        };
        
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });
        
        if (response.ok) {
            // Update the toggle appearance
            const toggleDiv = minimizeToTrayCheckbox.nextElementSibling;
            if (minimizeToTrayCheckbox.checked) {
                toggleDiv.classList.add('bg-blue-500');
                toggleDiv.classList.remove('bg-gray-600');
            } else {
                toggleDiv.classList.remove('bg-blue-500');
                toggleDiv.classList.add('bg-gray-600');
            }
            showNotification('Settings saved successfully', 'success');
        } else {
            showNotification('Failed to save settings', 'error');
        }
    } catch (error) {
        console.error('Error updating settings:', error);
        showNotification('Failed to save settings', 'error');
    }
}

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
                updateGamesList(); // Update UI if status changed
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

function updatePresetsList(presets) {
    const presetsList = document.getElementById('presetsList');
    presetsList.innerHTML = '';

    presets.forEach(preset => {
        const presetCard = document.createElement('div');
        presetCard.className = 'preset-card bg-gray-800 rounded-lg p-4';
        
        // Check if all games in the preset are running
        const isPresetRunning = preset.games.every(game => runningGames.has(game.id.toString()));
        
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
                <h3 class="text-lg font-semibold">${preset.name}</h3>
                <div class="flex gap-2">
                    <button onclick="${isPresetRunning ? 'stopPreset' : 'runPreset'}('${preset.name}')" 
                            class="bg-${isPresetRunning ? 'red' : 'green'}-500 hover:bg-${isPresetRunning ? 'red' : 'green'}-600 px-4 py-2 rounded text-sm">
                        <i class="fas fa-${isPresetRunning ? 'stop' : 'play'} mr-1"></i>${isPresetRunning ? 'Stop All' : 'Run All'}
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
        
        // Update Steam status indicator
        const statusIndicator = document.getElementById('steamStatus');
        if (statusIndicator) {
            if (status.running && status.online) {
                statusIndicator.className = 'text-green-500';
                statusIndicator.innerHTML = '<i class="fas fa-circle mr-1"></i>Steam Online';
            } else if (status.running) {
                statusIndicator.className = 'text-yellow-500';
                statusIndicator.innerHTML = '<i class="fas fa-circle mr-1"></i>Steam Offline';
            } else {
                statusIndicator.className = 'text-red-500';
                statusIndicator.innerHTML = '<i class="fas fa-circle mr-1"></i>Steam Not Running';
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

async function startGame(gameId) {
    try {
        // Check Steam status first
        const steamStatus = await updateSteamStatus();
        if (!steamStatus) {
            showNotification('Unable to check Steam status', 'error');
            return;
        }
        
        if (!steamStatus.running) {
            const shouldLaunch = confirm('Steam is not running. Would you like to launch Steam now?');
            if (shouldLaunch) {
                await launchSteam();
                showNotification('Please try starting the game again once Steam is running', 'info');
                return;
            }
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

async function deletePreset(presetName) {
    if (!confirm(`Are you sure you want to delete preset "${presetName}"?`)) {
        return;
    }

    try {
        const response = await fetch('/api/delete-preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: presetName })
        });

        if (!response.ok) {
            throw new Error('Failed to delete preset');
        }

        loadPresets();
    } catch (error) {
        console.error('Error deleting preset:', error);
        alert('Failed to delete preset');
    }
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

async function runPreset(presetName) {
    try {
        // Check Steam status first
        const steamStatus = await updateSteamStatus();
        if (!steamStatus) {
            showNotification('Unable to check Steam status', 'error');
            return;
        }
        
        if (!steamStatus.running) {
            const shouldLaunch = confirm('Steam is not running. Would you like to launch Steam now?');
            if (shouldLaunch) {
                await launchSteam();
                showNotification('Please try starting the preset again once Steam is running', 'info');
                return;
            }
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