// At the top of the file, add theme initialization
let currentTheme = 'dark';  // Default theme

// Initialize theme from localStorage if available
if (localStorage.getItem('theme')) {
    currentTheme = localStorage.getItem('theme');
    document.documentElement.setAttribute('data-theme', currentTheme);
}

let currentGames = [];
let runningGames = new Set();
let runningPresets = new Set();
let quickActionsEnabled = false;
let presetToDelete = null;
let presetToRename = null;
let presetToEdit = null;
let editedGames = [];
let welcomeStartupEnabled = false;
let welcomeMinimizeEnabled = false;
let welcomeIdleExePath = null;
let currentViewSize = localStorage.getItem('libraryViewSize') || 'normal'; // compact, normal, large

// Add these variables at the top of the file, after other global variables
let playtimeInterval = null;
let gameStartTimes = new Map();
let areGamesMinimized = false;

// Add these variables for preset management
let presetsCache = null;
let isUpdatingPresets = false;

// Debounce function to prevent multiple rapid updates
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Initialize the application when the DOM is loaded
document.addEventListener('DOMContentLoaded', async function() {
    await checkFirstTimeSetup();
    await updateSteamStatus();
    await updateStatistics();
    await updateQuickActions();
    applyTheme(currentTheme);
    
    // Initialize presets cache
    await refreshPresetsCache();
    
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

    // Load saved theme from backend
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        if (settings.theme) {
            currentTheme = settings.theme;
            document.documentElement.setAttribute('data-theme', currentTheme);
            applyTheme(currentTheme);
            updateThemeButtons();
        }
    } catch (error) {
        console.error('Error loading theme:', error);
    }
});

// Add status checking intervals
setInterval(updateGameStatuses, 2000); // Check every 2 seconds
setInterval(updatePlaytimes, 1000); // Update playtimes every second
setInterval(updateSteamStatus, 10000); // Check Steam status every 10 seconds
setInterval(updateStatistics, 5000); // Update statistics every 5 seconds
setInterval(updateQuickActions, 5000); // Update quick actions panel

async function updateGameStatuses() {
    // Check status for all running games
    for (const gameId of runningGames) {
        await checkGameStatus(gameId);
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
                runningGames.delete(gameId); // Clear the start time when game stops
            }
            if (wasRunning !== data.running) {
                updateGamesList();
                updateRunningGamesList(); // Update running games list when status changes
                triggerGameStateChange();
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
        showNotification('This game is already in the preset', 'error');
        return;
    }

    currentGames.push(gameInfo);
    
    // Add to history using API
    fetch('/api/game-history', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            id: gameInfo.id,
            name: gameInfo.name,
            image: gameInfo.image
        })
    }).then(response => response.json())
        .then(data => {
            gameHistory = data.history;
            updateGamesList();
        })
        .catch(error => {
            console.error('Error updating history:', error);
            showNotification('Failed to update history', 'error');
        });
}

function removeGame(gameId) {
    currentGames = currentGames.filter(game => game.id !== gameId);
    updateGamesList();
}

function updateGamesList() {
    const gamesList = document.getElementById('gamesList');
    const startStopAllBtn = document.getElementById('startStopAllBtn');
    const exportGamesBtn = document.getElementById('exportGamesBtn');
    const currentGamesCount = document.getElementById('currentGamesCount');
    if (!gamesList) return;
    
    gamesList.innerHTML = '';
    
    // Update the games count with proper singular/plural form
    const gameText = currentGames.length === 1 ? 'game' : 'games';
    currentGamesCount.textContent = `(${currentGames.length} ${gameText})`;
    
    // Show/hide and update Start/Stop All button and export button based on games list
    if (currentGames.length > 0) {
        startStopAllBtn.classList.remove('hidden');
        exportGamesBtn.classList.remove('hidden');
        const allGamesRunning = currentGames.every(game => runningGames.has(game.id.toString()));
        
        if (allGamesRunning) {
            startStopAllBtn.classList.remove('hover:text-green-500');
            startStopAllBtn.classList.add('hover:text-red-500');
            startStopAllBtn.querySelector('i').className = 'fas fa-stop text-xl';
            startStopAllBtn.querySelector('.opacity-0').textContent = 'Stop All Games';
        } else {
            startStopAllBtn.classList.remove('hover:text-red-500');
            startStopAllBtn.classList.add('hover:text-green-500');
            startStopAllBtn.querySelector('i').className = 'fas fa-play text-xl';
            startStopAllBtn.querySelector('.opacity-0').textContent = 'Start All Games';
        }
    } else {
        startStopAllBtn.classList.add('hidden');
        exportGamesBtn.classList.add('hidden');
        currentGamesCount.textContent = '(0 games)';
    }
    
    currentGames.forEach(game => {
        const isRunning = runningGames.has(game.id.toString());
        const isFavorite = gameFavorites.some(fav => fav.id === game.id);
        
        const gameCard = document.createElement('div');
        gameCard.className = 'game-card bg-gray-800 rounded-lg overflow-hidden relative';
        gameCard.setAttribute('data-game-id', game.id);
        
        // Get playtime for running games
        if (isRunning) {
            fetch('/api/game-session-time', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ gameId: game.id })
            })
            .then(response => response.json())
            .then(data => {
                const playtimeElement = gameCard.querySelector('.playtime-info');
                if (playtimeElement) {
                    playtimeElement.innerHTML = `
                        <div class="text-green-400">Current Session: ${data.current_session}</div>
                        <div class="text-blue-400">Total Time: ${data.total_time}</div>
                    `;
                }
            })
            .catch(error => {
                console.error('Error fetching playtime:', error);
            });
        }
        
        gameCard.innerHTML = `
            <div class="relative">
                <img src="${game.image || 'https://via.placeholder.com/460x215/374151/FFFFFF?text=No+Image'}" 
                     alt="${game.name}" 
                     class="w-full h-48 object-cover">
                <button onclick="toggleGameFavorite('${game.id}')" 
                        class="favorite-button absolute top-2 right-2">
                    <i class="fas fa-star text-xl ${isFavorite ? 'text-yellow-400 glow-yellow' : 'text-gray-500 hover:text-yellow-400'}"></i>
                </button>
                ${isRunning ? '<span class="absolute top-2 left-2 bg-green-500 text-white px-2 py-1 rounded text-xs">Running</span>' : ''}
            </div>
            <div class="p-4">
                <div class="flex justify-between items-start mb-2">
                    <h3 class="text-lg font-semibold">${game.name}</h3>
                </div>
                <div class="flex items-center gap-2 mb-4">
                    <p class="text-sm text-gray-400">ID: ${game.id}</p>
                    <a href="https://store.steampowered.com/app/${game.id}" 
                       target="_blank"
                       class="text-gray-400 hover:text-blue-400 transition-colors group relative">
                        <i class="fab fa-steam text-lg"></i>
                        <!-- Tooltip -->
                        <div class="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg whitespace-nowrap">
                            View on Steam Store
                            <!-- Arrow -->
                            <div class="absolute left-1/2 transform -translate-x-1/2 top-full">
                                <div class="w-2 h-2 bg-gray-900 transform rotate-45"></div>
                            </div>
                        </div>
                    </a>
                </div>
                <div class="playtime-info mb-4">
                    
                </div>
                <div class="flex gap-2">
                    <button onclick="${isRunning ? 'stopGame' : 'startGame'}('${game.id}')" 
                            class="flex-1 bg-${isRunning ? 'red' : 'green'}-500 hover:bg-${isRunning ? 'red' : 'green'}-600 px-4 py-2 rounded text-sm font-medium">
                        <i class="fas fa-${isRunning ? 'stop' : 'play'} mr-1"></i>${isRunning ? 'Stop' : 'Start'}
                    </button>
                    <button onclick="removeGame('${game.id}')" 
                            class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded text-sm">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
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

// Function to clean up save button highlight and form
function cleanupSaveHighlight() {
    const saveButton = document.querySelector('button[onclick="savePreset()"]');
    if (saveButton) {
        saveButton.classList.remove('save-button-highlight', 'pulse-animation');
        const reminder = saveButton.parentElement.querySelector('.save-reminder');
        if (reminder) {
            reminder.remove();
        }
    }
}

// Function to dismiss the current preset
function dismissPreset() {
    // Clear the current games array
    currentGames = [];
    
    // Clear the preset name input
    document.getElementById('presetName').value = '';
    
    // Clean up any save highlights and reminders
    cleanupSaveHighlight();
    
    // Clear the file input
    const fileInput = document.getElementById('presetFile');
    fileInput.value = '';
    
    // Show notification
    showNotification('Preset dismissed', 'info');
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
        // If we're already updating, wait for it to finish
        if (isUpdatingPresets) {
            return returnData ? presetsCache : undefined;
        }

        isUpdatingPresets = true;

        const response = await fetch('/api/get-presets');
        const presets = await response.json();
        
        // Update cache
        presetsCache = presets;

        if (!returnData) {
            await updatePresetsList(presets);
        }

        isUpdatingPresets = false;
        return presets;
    } catch (error) {
        console.error('Error loading presets:', error);
        showNotification('Failed to load presets', 'error');
        isUpdatingPresets = false;
        return returnData ? [] : undefined;
    }
}

// Debounced version of updatePresetsList
const debouncedUpdatePresetsList = debounce(async (presets) => {
    const presetsList = document.getElementById('presetsList');
    if (!presetsList) return;

    // Clear existing content
    presetsList.innerHTML = '';

    // Get favorites data
    const favoritesResponse = await fetch('/api/favorites');
    const favoritesData = await favoritesResponse.json();
    const favoriteNames = favoritesData.favorites.map(f => f.name);

    presets.forEach(preset => {
        const isPresetRunning = preset.games.every(game => runningGames.has(game.id.toString()));
        const isFavorited = favoriteNames.includes(preset.name);
        
        const presetCard = document.createElement('div');
        presetCard.className = 'preset-card bg-gray-800 rounded-lg p-4';
        
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
                                class="text-${isFavorited ? 'yellow' : 'gray'}-500 hover:text-yellow-400 transition-colors duration-200 ${isFavorited ? 'glow-yellow' : ''} group relative">
                            <i class="fas fa-star"></i>
                            <!-- Tooltip -->
                            <div class="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg whitespace-nowrap">
                                ${isFavorited ? 'Remove from Favorites' : 'Add to Favorites'}
                                <!-- Arrow -->
                                <div class="absolute left-1/2 transform -translate-x-1/2 top-full">
                                    <div class="w-2 h-2 bg-gray-900 transform rotate-45"></div>
                                </div>
                            </div>
                        </button>
                        <button onclick="showRenamePresetModal('${preset.name}')"
                                class="text-blue-500 hover:text-blue-400 transition-colors group relative">
                            <i class="fas fa-edit"></i>
                            <!-- Tooltip -->
                            <div class="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-sm rounded-lg whitespace-nowrap">
                                Rename Preset
                                <!-- Arrow -->
                                <div class="absolute left-1/2 transform -translate-x-1/2 top-full">
                                    <div class="w-2 h-2 bg-gray-900 transform rotate-45"></div>
                                </div>
                            </div>
                        </button>
                        <div class="relative group">
                            <button class="text-blue-500 hover:text-blue-400 transition-colors">
                                <i class="fas fa-download"></i>
                            </button>
                            <!-- Export Dropdown -->
                            <div class="opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 bg-gray-900 text-white text-sm rounded-lg whitespace-nowrap">
                                <div class="py-2">
                                    <button onclick="exportPreset('${preset.name}', 'ids')" 
                                            class="block w-full px-4 py-2 text-left hover:bg-gray-800 transition-colors">
                                        Export Game IDs
                                    </button>
                                    <button onclick="exportPreset('${preset.name}', 'names')" 
                                            class="block w-full px-4 py-2 text-left hover:bg-gray-800 transition-colors">
                                        Export Game Names
                                    </button>
                                </div>
                                <!-- Arrow -->
                                <div class="absolute left-1/2 transform -translate-x-1/2 top-full">
                                    <div class="w-2 h-2 bg-gray-900 transform rotate-45"></div>
                                </div>
                            </div>
                        </div>
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
}, 250); // 250ms debounce time

// Modify the updatePresetsList function to use the debounced version
async function updatePresetsList(presets) {
    await debouncedUpdatePresetsList(presets);
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
        // Get game info from currentGames or presetsCache
        const game = currentGames.find(g => g.id.toString() === gameId.toString()) || 
                    presetsCache?.flatMap(p => p.games).find(g => g.id.toString() === gameId.toString());

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
            showNotification(game ? `Stopped "${game.name}" successfully` : 'Game stopped successfully', 'success');
            updateRunningGamesList();
        } else {
            showNotification('Failed to stop game', 'error');
        }
    } catch (error) {
        console.error('Error stopping game:', error);
        showNotification('Error stopping game', 'error');
    }
    gameStartTimes.delete(gameId);
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
    loadingOverlay.classList.remove('hidden');
    const statusText = document.getElementById('importStatus');
    const saveButton = document.querySelector('button[onclick="savePreset()"]');
    
    try {
        statusText.textContent = 'Analyzing file...';
        
        const reader = new FileReader();
        reader.onload = async function() {
            try {
                const content = reader.result;
                let gameIds = [];
                
                // Check file type and parse accordingly
                if (file.name.endsWith('.bat')) {
                    // Parse BAT file for steam-idle.exe commands
                    gameIds = content.match(/steam-idle\.exe\s+(\d+)/g)
                    ?.map(match => match.match(/\d+/)[0]) || [];
                } else if (file.name.endsWith('.txt')) {
                    // Parse TXT file - split by newlines and clean up each line
                    const lines = content.split(/\r?\n/).filter(line => line.trim());
                    
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (/^\d+$/.test(trimmedLine)) {
                            // Line contains only numbers - treat as game ID
                            gameIds.push(trimmedLine);
                        } else if (trimmedLine) {
                            // Line contains text - treat as game name
                            statusText.textContent = `Searching for game: ${trimmedLine}...`;
                            try {
                                const searchResponse = await fetch('/api/fetch-game', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ gameId: trimmedLine })
                                });
                                
                                if (searchResponse.ok) {
                                    const gameInfo = await searchResponse.json();
                                    if (gameInfo && gameInfo.id) {
                                        gameIds.push(gameInfo.id.toString());
                                    }
                                }
                                // Add delay between searches
                                await new Promise(resolve => setTimeout(resolve, 500));
                            } catch (error) {
                                console.warn(`Could not find game: ${trimmedLine}`, error);
                            }
                        }
                    }
                }
                
                if (gameIds.length === 0) {
                    throw new Error('No valid game IDs or names found in the file');
                }
                
                // Clear current games
                currentGames = [];
                
                // Fetch info for each game
                const uniqueGameIds = [...new Set(gameIds)]; // Remove duplicates
                for (let i = 0; i < uniqueGameIds.length; i++) {
                    statusText.textContent = `Fetching game info (${i + 1}/${uniqueGameIds.length})...`;
                    
                    const response = await fetch('/api/fetch-game', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ gameId: uniqueGameIds[i] })
                    });
                    
                    if (response.ok) {
                        const gameInfo = await response.json();
                        if (!currentGames.some(game => game.id === gameInfo.id)) {
                            currentGames.push(gameInfo);
                        }
                    }
                    
                    // Add delay to prevent overwhelming Steam API
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // Set preset name from file name
                const fileName = file.name.replace(/\.(bat|txt)$/, '');
                document.getElementById('presetName').value = fileName;
                
                // Show success UI
                showNotification(`Successfully imported ${currentGames.length} games. Click Save to confirm or Dismiss to cancel.`, 'info');
                
                // Add visual cues to save
                saveButton.classList.add('save-button-highlight', 'pulse-animation');
                
                // Add save reminder with dismiss option
                const reminderText = document.createElement('div');
                reminderText.className = 'text-sm text-blue-400 mt-2 text-center save-reminder';
                reminderText.innerHTML = '<i class="fas fa-arrow-left animate-slide-left mr-2"></i>Click Save to confirm preset or Dismiss to cancel';
                saveButton.parentElement.appendChild(reminderText);
                
            } catch (error) {
                console.error('Error processing file:', error);
                showNotification(error.message || 'Failed to process file', 'error');
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        };
        
        reader.onerror = function() {
            loadingOverlay.classList.add('hidden');
            showNotification('Error reading file', 'error');
        };
        
        reader.readAsText(file);
        
    } catch (error) {
        console.error('Error importing file:', error);
        showNotification('Failed to import file', 'error');
        loadingOverlay.classList.add('hidden');
    }
}

function showDeletePresetModal(presetName) {
    presetToDelete = presetName;
    const modal = document.getElementById('deletePresetModal');
    const nameSpan = document.getElementById('deletePresetName');
    
    nameSpan.textContent = presetName;
    
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
            body: JSON.stringify({
                name: presetToDelete
            })
        });
        
        if (response.ok) {
            showNotification(`Preset "${presetToDelete}" deleted successfully`, 'success');
            updatePresetsList(await loadPresets(true));
            updateFavoritePresets();
        } else {
            const data = await response.json();
            showNotification(data.message || 'Failed to delete preset', 'error');
        }
    } catch (error) {
        console.error('Error deleting preset:', error);
        showNotification('Failed to delete preset', 'error');
    }
    
    closeDeletePresetModal();
}

// Update the existing deletePreset function
async function deletePreset(presetName) {
    if (runningGames.size > 0) {
        showNotification('Please stop all running games before deleting the preset', 'error');
        return;
    }
    showDeletePresetModal(presetName);
}

async function stopPreset(presetName) {
    try {
        // Use cached preset data if available
        const preset = presetsCache?.find(p => p.name === presetName);
        
        if (!preset) {
            throw new Error('Preset not found');
        }

        // Keep track of stopped games
        const stoppedGames = [];

        // Stop each game in the preset
        for (const game of preset.games) {
            if (runningGames.has(game.id.toString())) {
                await stopGame(game.id);
                stoppedGames.push(game.name);
            }
        }

        // Remove from running presets
        runningPresets.delete(presetName);

        // Update UI with a single loadPresets call
        const updatedPresets = await loadPresets(true);
        await debouncedUpdatePresetsList(updatedPresets);
        updateGamesList();
        
        // Show success message with game names
        if (stoppedGames.length > 0) {
            const gamesList = stoppedGames.join(', ');
            showNotification(`Stopped games in preset "${presetName}": ${gamesList}`, 'success');
        } else {
            showNotification(`No running games found in preset "${presetName}"`, 'info');
        }
    } catch (error) {
        console.error('Error stopping preset:', error);
        showNotification('Failed to stop preset', 'error');
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type} fixed bottom-4 right-4 p-4 rounded-lg flex items-center gap-3 z-50`;
    
    // Add appropriate icon based on notification type
    let icon;
    switch (type) {
        case 'success':
            icon = 'fa-check-circle';
            break;
        case 'error':
            icon = 'fa-exclamation-circle';
            break;
        case 'warning':
            icon = 'fa-exclamation-triangle';
            break;
        default:
            icon = 'fa-info-circle';
    }
    
    notification.innerHTML = `
        <i class="fas ${icon}"></i>
        <span class="flex-1">${message}</span>
        <button onclick="this.parentElement.remove()" class="text-gray-400 hover:text-gray-300 transition-colors">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    document.body.appendChild(notification);
    
    // Remove notification after 5 seconds
    setTimeout(() => {
        notification.classList.add('hiding');
        setTimeout(() => notification.remove(), 300);
    }, 5000);
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

// Add loading overlay HTML at the start of the file
let presetLoadingOverlay = null;

function createPresetLoadingOverlay() {
    if (!presetLoadingOverlay) {
        const overlayHtml = `
            <div id="presetLoadingOverlay" class="fixed inset-0 bg-black bg-opacity-50 z-[100] hidden items-center justify-center">
                <div class="bg-gray-800 rounded-lg p-8 flex flex-col items-center">
                    <div class="loader mb-4"></div>
                    <p class="text-lg font-semibold">Running Preset...</p>
                    <p class="text-sm text-gray-400 mt-2" id="presetLoadingStatus">Starting games...</p>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', overlayHtml);
        presetLoadingOverlay = document.getElementById('presetLoadingOverlay');
    }
    return presetLoadingOverlay;
}

// Add this function near the top with other UI-related functions
function showLoadingOverlay(message) {
    const overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    overlay.innerHTML = `
        <div class="bg-gray-800 rounded-lg p-8 flex flex-col items-center max-w-md w-full mx-4">
            <div class="w-16 h-16 mb-4">
                <svg class="animate-spin w-full h-full text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
            <div class="text-center">
                <p class="text-xl font-semibold text-white mb-2">${message}</p>
                <p class="text-gray-400 text-sm loading-dots">Starting games<span class="dot-1">.</span><span class="dot-2">.</span><span class="dot-3">.</span></p>
            </div>
        </div>
    `;

    // Add the loading dots animation style
    const style = document.createElement('style');
    style.textContent = `
        @keyframes loadingDots {
            0%, 20% {
                opacity: 0;
            }
            50% {
                opacity: 1;
            }
            100% {
                opacity: 0;
            }
        }
        .loading-dots .dot-1 {
            animation: loadingDots 1.5s infinite;
            animation-delay: 0s;
        }
        .loading-dots .dot-2 {
            animation: loadingDots 1.5s infinite;
            animation-delay: 0.5s;
        }
        .loading-dots .dot-3 {
            animation: loadingDots 1.5s infinite;
            animation-delay: 1s;
        }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.remove();
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
        const preset = presetsCache?.find(p => p.name === presetName);
        
        if (!preset) {
            showNotification('Preset not found', 'error');
            return;
        }

        // Show loading overlay
        showLoadingOverlay(`Starting games in preset "${presetName}"...`);
        
        const response = await fetch('/api/run-preset', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: presetName })
        });

        const data = await response.json();
        
        // Hide loading overlay
        hideLoadingOverlay();
        
        if (!response.ok) {
            showNotification(data.message || 'Failed to run preset', 'error');
            return;
        }

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

            // Update UI - use a single loadPresets call
            const updatedPresets = await loadPresets(true);
            await debouncedUpdatePresetsList(updatedPresets);
            updateGamesList();
            updateRunningGamesList();
            
            // Show success message with game names
            const startedGames = preset.games.filter(game => data.gameIds.includes(game.id.toString()));
            const gameNames = startedGames.map(game => game.name).join(', ');
            const message = `Started games in preset "${presetName}": ${gameNames}`;
            showNotification(message, 'success');
        }
    } catch (error) {
        // Hide loading overlay in case of error
        hideLoadingOverlay();
        console.error('Error running preset:', error);
        if (!error.handled) {
            showNotification('Failed to run preset', 'error');
        }
    }
}

async function updateStatistics() {
    if (document.getElementById('statsContent').classList.contains('hidden')) {
        return; // Don't update if stats tab is not visible
    }

    try {
        // Get total playtime from server (this already includes current session times)
        const totalResponse = await fetch('/api/stats/total-playtime');
        const totalData = await totalResponse.json();

        // Update total playtime display
        document.getElementById('totalPlaytime').textContent = totalData.total_time;
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

// Add interval to update statistics regularly
setInterval(updateStatistics, 1000); // Update every second

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
            gameStartTimes.clear();
            if (playtimeInterval) {
                clearInterval(playtimeInterval);
                playtimeInterval = null;
            }
            updateGamesList();
            updatePresetsList(await loadPresets(true));
            updateRunningGamesList(); // This will now show the "No games running" message
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
            { name: 'Steam Idle Path', promise: updateIdlePath() },
            { name: 'Discord RPC', promise: updateDiscordRPCToggle() }
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

    loadExportPreferences();
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
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ theme: theme })
        });

        if (response.ok) {
            currentTheme = theme;
            localStorage.setItem('theme', theme);
            document.documentElement.setAttribute('data-theme', theme);
            applyTheme(theme);
            updateThemeButtons();
            showNotification(`${theme.charAt(0).toUpperCase() + theme.slice(1)} theme applied successfully`, 'success');
        }
    } catch (error) {
        console.error('Error setting theme:', error);
        showNotification('Failed to set theme', 'error');
    }
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    
    // Update specific elements that might need explicit color changes
    const elements = {
        modals: [
            'settingsModal',
            'welcomeConfigModal',
            'libraryModal',
            'editPresetModal',
            'runningGamesModal',
            'shortcutModal',
            'emergencyStopConfirmModal',
            'resetStatsModal',
            'renamePresetModal',
            'deletePresetModal'
        ],
        inputs: document.querySelectorAll('input, select, textarea'),
        buttons: document.querySelectorAll('button:not(.bg-blue-500):not(.bg-red-500):not(.bg-green-500)'),
        cards: document.querySelectorAll('.game-card, .preset-card'),
        labels: document.querySelectorAll('.text-gray-300, .text-gray-400, .text-white')
    };

    // Update modal backgrounds and text
    elements.modals.forEach(modalId => {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.querySelectorAll('.bg-gray-800').forEach(el => {
                el.style.backgroundColor = theme === 'light' ? '#FFFFFF' : '#1F2937';
            });
            modal.querySelectorAll('.text-gray-300, .text-gray-400').forEach(el => {
                el.style.color = theme === 'light' ? '#4B5563' : '#9CA3AF';
            });
        }
    });

    // Update input backgrounds and text
    elements.inputs.forEach(input => {
        input.style.backgroundColor = theme === 'light' ? '#FFFFFF' : '#374151';
        input.style.color = theme === 'light' ? '#111827' : '#FFFFFF';
    });

    // Update button text colors
    elements.buttons.forEach(button => {
        if (!button.classList.contains('bg-blue-500') && 
            !button.classList.contains('bg-red-500') && 
            !button.classList.contains('bg-green-500')) {
            button.style.color = theme === 'light' ? '#111827' : '#FFFFFF';
        }
    });

    // Update card backgrounds
    elements.cards.forEach(card => {
        card.style.backgroundColor = theme === 'light' ? '#FFFFFF' : '#1F2937';
    });

    // Update text colors
    elements.labels.forEach(label => {
        if (label.classList.contains('text-white')) {
            label.style.color = theme === 'light' ? '#111827' : '#FFFFFF';
        } else if (label.classList.contains('text-gray-400')) {
            label.style.color = theme === 'light' ? '#4B5563' : '#9CA3AF';
        } else if (label.classList.contains('text-gray-300')) {
            label.style.color = theme === 'light' ? '#6B7280' : '#D1D5DB';
        }
    });

    // Update Quick Actions Panel
    const quickActionsPanel = document.getElementById('quickActionsPanel');
    if (quickActionsPanel) {
        quickActionsPanel.style.backgroundColor = theme === 'light' ? '#FFFFFF' : '#1F2937';
        quickActionsPanel.querySelectorAll('.bg-gray-700').forEach(el => {
            el.style.backgroundColor = theme === 'light' ? '#F3F4F6' : '#374151';
        });
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
// Function to handle clicking outside the modal
function handleClickOutside(event) {
    const modal = document.getElementById('editPresetModal');
    const modalContent = modal.querySelector('.bg-gray-800');
    if (event.target === modal) {
        closeEditPresetModal();
    }
}

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

    // Add click outside listener
    modal.addEventListener('click', handleClickOutside);
}

function closeEditPresetModal() {
    const modal = document.getElementById('editPresetModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    presetToEdit = null;
    editedGames = [];
    // Remove click outside listener
    modal.removeEventListener('click', handleClickOutside);
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
    const toggle = document.getElementById('startupToggle');
    const isEnabled = toggle.classList.contains('bg-blue-500');
    const newState = !isEnabled;

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ run_on_startup: newState })
        });

        if (response.ok) {
            toggle.classList.toggle('bg-blue-500');
            toggle.classList.toggle('bg-gray-500');
            toggle.querySelector('span').style.transform = newState ? 'translateX(20px)' : 'translateX(0)';
            showNotification(`${newState ? 'Enabled' : 'Disabled'} run on startup`, 'success');
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
    const toggle = document.getElementById('minimizeToTrayToggle');
    const isEnabled = toggle.classList.contains('bg-blue-500');
    const newState = !isEnabled;

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ minimize_to_tray: newState })
        });

        if (response.ok) {
            toggle.classList.toggle('bg-blue-500');
            toggle.classList.toggle('bg-gray-500');
            toggle.querySelector('span').style.transform = newState ? 'translateX(20px)' : 'translateX(0)';
            showNotification(`${newState ? 'Enabled' : 'Disabled'} minimize to tray`, 'success');
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
    const toggle = document.getElementById('autoReconnectToggle');
    const isEnabled = toggle.classList.contains('bg-blue-500');
    const newState = !isEnabled;

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ auto_reconnect: newState })
        });

        if (response.ok) {
            toggle.classList.toggle('bg-blue-500');
            toggle.classList.toggle('bg-gray-500');
            toggle.querySelector('span').style.transform = newState ? 'translateX(20px)' : 'translateX(0)';
            showNotification(`${newState ? 'Enabled' : 'Disabled'} auto reconnect`, 'success');
        }
    } catch (error) {
        console.error('Error toggling auto reconnect:', error);
        showNotification('Failed to update auto reconnect setting', 'error');
    }
}

async function exportStats(format = 'csv') {
    try {
        // Get export preferences
        const exportPrefs = {
            game_id: document.getElementById('export_game_id').checked,
            game_name: document.getElementById('export_game_name').checked,
            store_url: document.getElementById('export_store_url').checked,
            time_hhmmss: document.getElementById('export_time_hhmmss').checked,
            hours: document.getElementById('export_hours').checked,
            percentage: document.getElementById('export_percentage').checked,
            rank: document.getElementById('export_rank').checked,
            status: document.getElementById('export_status').checked,
            session: document.getElementById('export_session').checked,
            favorite: document.getElementById('export_favorite').checked
        };

        // Save preferences to localStorage
        localStorage.setItem('exportPreferences', JSON.stringify(exportPrefs));

        const response = await fetch('/api/export-stats', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                format: format,
                preferences: exportPrefs
            })
        });

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `steam_idle_stats.${format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showNotification('Statistics exported successfully!', 'success');
        } else {
            throw new Error('Failed to export statistics');
        }
    } catch (error) {
        console.error('Error exporting statistics:', error);
        showNotification('Failed to export statistics', 'error');
    }
}

// Add function to load export preferences
function loadExportPreferences() {
    try {
        const savedPrefs = localStorage.getItem('exportPreferences');
        if (savedPrefs) {
            const prefs = JSON.parse(savedPrefs);
            Object.entries(prefs).forEach(([key, value]) => {
                const checkbox = document.getElementById(`export_${key}`);
                if (checkbox) {
                    checkbox.checked = value;
                }
            });
        }
    } catch (error) {
        console.error('Error loading export preferences:', error);
    }
}

// Add this to your existing openSettings function
async function openSettings() {
    // ... existing code ...
    loadExportPreferences();
    // ... rest of the function ...
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
            showNotification('Statistics reset successfully', 'success');
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

async function updateDiscordRPCToggle() {
    try {
        const response = await fetch('/api/settings');
        const settings = await response.json();
        updateToggleState('discordRpcToggle', settings.discord_rpc_enabled);
            } catch (error) {
        console.error('Error updating Discord RPC toggle:', error);
    }
}

async function toggleDiscordRPC() {
    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                discord_rpc_enabled: !document.getElementById('discordRpcToggle').classList.contains('bg-blue-500')
            })
        });

        if (response.ok) {
            updateDiscordRPCToggle();
            showNotification('Discord RPC settings updated successfully');
        } else {
            showNotification('Failed to update Discord RPC settings', 'error');
        }
    } catch (error) {
        console.error('Error toggling Discord RPC:', error);
        showNotification('Failed to update Discord RPC settings', 'error');
    }
}

// Add to the existing openSettings function
async function openSettings() {
    try {
        document.getElementById('settingsLoading').classList.remove('hidden');
        document.getElementById('settingsModal').classList.add('flex');
        document.getElementById('settingsModal').classList.remove('hidden');
        
        // Update all toggles
        await Promise.all([
            updateStartupToggle(),
            updateMinimizeToTrayToggle(),
            updateAutoReconnectToggle(),
            updateDiscordRPCToggle(),  // Add this line
            updateThemeButtons()
        ]);
        
        // Update idle path
        const response = await fetch('/api/get-idle-path');
        const data = await response.json();
        document.getElementById('currentIdlePath').textContent = data.path || 'Not configured';
        
        document.getElementById('settingsLoading').classList.add('hidden');
    } catch (error) {
        console.error('Error opening settings:', error);
        document.getElementById('settingsLoading').classList.add('hidden');
    }

    loadExportPreferences();
}

// ... rest of the existing code ...

// Add function to handle adding a game to a new preset
async function addGameToNewPreset(gameId) {
    const game = libraryGames.find(g => g.id.toString() === gameId.toString());
    if (!game) return;
    
    // Add to current games list with all necessary properties
    if (!currentGames.some(g => g.id === game.id)) {
        currentGames.push({
            id: game.id,
            name: game.name,
            image: game.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.id}/header.jpg`,
            appid: game.id // Ensure appid is included for compatibility
        });
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
    
    // Get selected games info with all necessary properties
    const selectedGames = libraryGames
        .filter(game => selectedLibraryGames.has(game.id))
        .map(game => ({
            id: game.id,
            name: game.name,
            image: game.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.id}/header.jpg`,
            appid: game.id // Ensure appid is included for compatibility
        }));
    
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
    
    // Add click event listener to close modal when clicking outside
    modal.addEventListener('click', function(e) {
        // Check if the click was on the modal background (not the content)
        if (e.target === modal) {
            closeRunningGames();
        }
    });
    
    updateRunningGamesList();
}

function closeRunningGames() {
    const modal = document.getElementById('runningGamesModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    if (playtimeInterval) {
        clearInterval(playtimeInterval);
        playtimeInterval = null;
    }
}

async function updateRunningGamesList() {
    const gamesList = document.getElementById('runningGamesList');
    const modalCount = document.getElementById('runningGamesModalCount');
    const headerCount = document.getElementById('runningGamesCount');
    const totalPlaytimeCounter = document.getElementById('totalPlaytimeCounter');
    
    // Update counts
    const runningCount = runningGames.size;
    modalCount.textContent = `(${runningCount} ${runningCount === 1 ? 'game' : 'games'})`;
    
    // Clear previous interval if it exists
    if (playtimeInterval) {
        clearInterval(playtimeInterval);
        playtimeInterval = null;
    }
    
    // Update header badge
    if (runningCount > 0) {
        headerCount.textContent = runningCount;
        headerCount.classList.remove('hidden');
    } else {
        headerCount.classList.add('hidden');
        totalPlaytimeCounter.textContent = 'Total: 00:00:00';
        gameStartTimes.clear();
        // Show no games running message
        gamesList.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <i class="fas fa-gamepad text-4xl mb-4"></i>
                <p class="text-lg">No games currently running</p>
            </div>
        `;
        return;
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
                
                // Store or update start time for this game
                if (!gameStartTimes.has(gameId)) {
                    gameStartTimes.set(gameId, Date.now());
                }
                
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
    
    // Set up real-time counter
    playtimeInterval = setInterval(() => {
        let totalSeconds = 0;
        
        // Calculate total seconds for all running games
        for (const [gameId, startTime] of gameStartTimes.entries()) {
            if (runningGames.has(gameId)) {
                const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
                totalSeconds += elapsedSeconds;
            }
        }
        
        // Format total time as HH:MM:SS
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        totalPlaytimeCounter.textContent = `Total: ${formattedTime}`;
    }, 1000);
    
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

function updateToggleState(toggleId, enabled) {
    const toggle = document.getElementById(toggleId);
    if (!toggle) return;
    
    if (enabled) {
        toggle.classList.add('bg-blue-500');
        toggle.classList.remove('bg-gray-500');
        toggle.querySelector('span').style.transform = 'translateX(20px)';
    } else {
        toggle.classList.remove('bg-blue-500');
        toggle.classList.add('bg-gray-500');
        toggle.querySelector('span').style.transform = 'translateX(0)';
    }
}

// Add the toggleMinimizeAllGames function after the other functions
async function toggleMinimizeAllGames() {
    try {
        const response = await fetch('/api/toggle-minimize-games', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                minimize: !areGamesMinimized
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success) {
                areGamesMinimized = !areGamesMinimized;
                
                // Update both minimize buttons (in header and running games modal)
                const buttons = [
                    document.getElementById('minimizeAllGamesBtn'),
                    document.querySelector('#runningGamesModal #minimizeAllGamesBtn')
                ];
                
                buttons.forEach(button => {
                    if (button) {
                        const icon = button.querySelector('i');
                        const tooltip = button.querySelector('#minimizeTooltip');
                        
                        if (areGamesMinimized) {
                            icon.classList.remove('fa-window-minimize');
                            icon.classList.add('fa-window-maximize');
                            if (tooltip) tooltip.textContent = 'Restore All Games';
                        } else {
                            icon.classList.remove('fa-window-maximize');
                            icon.classList.add('fa-window-minimize');
                            if (tooltip) tooltip.textContent = 'Minimize All Games';
                        }
                    }
                });
                
                showNotification(data.message, 'success');
            } else {
                showNotification('Failed to toggle window state', 'error');
            }
        }
    } catch (error) {
        console.error('Error toggling minimize state:', error);
        showNotification('Failed to toggle window state', 'error');
    }
}

async function updateLibraryDisplay() {
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

    // Get idle hours for each game
    const idleHoursPromises = filteredGames.map(async game => {
        try {
            const response = await fetch('/api/game-session-time', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId: game.id })
            });
            const data = await response.json();
            return { gameId: game.id, idleTime: data.total_time };
        } catch (error) {
            console.error('Error fetching idle time:', error);
            return { gameId: game.id, idleTime: '00:00:00' };
        }
    });

    const idleHours = await Promise.all(idleHoursPromises);
    const idleHoursMap = new Map(idleHours.map(({ gameId, idleTime }) => [gameId, idleTime]));

    // Create and append all game cards
    filteredGames.forEach(game => {
        const isRunning = runningGames.has(game.id.toString());
        const gameCard = document.createElement('div');
        gameCard.className = `game-card ${currentViewSize}-card`;
        
        // Get idle time for this game
        const idleTime = idleHoursMap.get(game.id) || '00:00:00';
        
        gameCard.innerHTML = `
            <div class="relative">
                <img src="${game.icon || 'https://via.placeholder.com/460x215/374151/FFFFFF?text=No+Image'}" 
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
                    ''}
                ${isRunning ? 
                    '<span class="absolute top-2 left-24 bg-blue-500 text-white px-2 py-1 rounded text-xs">Running</span>' :
                    ''}
            </div>
            <div class="p-4">
                <h3 class="text-lg font-semibold mb-2">${game.name}</h3>
                <div class="text-sm text-gray-400">
                    <p class="text-green-400">Idle Hours: ${idleTime}</p>
                    <p class="text-xs mt-2">Game ID: ${game.id}</p>
                </div>
                <div class="mt-4 flex gap-2">
                    ${isRunning ?
                        `<button onclick="stopGame('${game.id}')" 
                                class="flex-1 bg-red-500 hover:bg-red-600 px-4 py-2 rounded text-sm">
                            <i class="fas fa-stop mr-1"></i>Stop
                        </button>` :
                        `<button onclick="startGame('${game.id}')" 
                                class="flex-1 bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded text-sm">
                            <i class="fas fa-play mr-1"></i>Start
                        </button>`
                    }
                    <button onclick="addGameToNewPreset('${game.id}')" 
                            class="flex-1 bg-green-500 hover:bg-green-600 px-4 py-2 rounded text-sm">
                        <i class="fas fa-plus mr-1"></i>Add to Preset
                    </button>
                </div>
            </div>
        `;
        
        libraryDiv.appendChild(gameCard);
    });
}

function setViewSize(size) {
    currentViewSize = size;
    localStorage.setItem('libraryViewSize', size);
    
    // Update view size buttons
    document.querySelectorAll('.view-size-btn').forEach(btn => {
        btn.classList.remove('text-blue-500');
        btn.classList.add('text-gray-400');
    });
    document.getElementById(`view${size.charAt(0).toUpperCase() + size.slice(1)}`).classList.add('text-blue-500');
    
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

function refreshLibrary() {
    clearLibrarySelection();
    loadSteamLibrary();
}

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

function closeLibrary() {
    const modal = document.getElementById('libraryModal');
    if (!modal) return;
    
    modal.classList.remove('flex');
    modal.classList.add('hidden');
    clearLibrarySelection();
}

// Add event listeners for library functionality
document.addEventListener('DOMContentLoaded', function() {
    // Library search input
    const librarySearch = document.getElementById('librarySearch');
    if (librarySearch) {
        librarySearch.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            updateLibraryDisplay();
        });
    }
    
    // Library modal click outside
    const libraryModal = document.getElementById('libraryModal');
    if (libraryModal) {
        libraryModal.addEventListener('click', (e) => {
            if (e.target === libraryModal) {
                closeLibrary();
            }
        });
    }
    
    // Set initial view size from localStorage
    const savedViewSize = localStorage.getItem('libraryViewSize');
    if (savedViewSize) {
        currentViewSize = savedViewSize;
        setViewSize(savedViewSize);
    }
});

// ... existing code ...

// Add these variables at the top of the file
let gameHistory = [];
let gameFavorites = [];
let gameSearchTimeout = null;

// Initialize history and favorites when the page loads
document.addEventListener('DOMContentLoaded', async function() {
    // Initialize history and favorites from backend
    try {
        const [historyResponse, favoritesResponse] = await Promise.all([
            fetch('/api/game-history'),
            fetch('/api/game-favorites')
        ]);
        
        if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            gameHistory = historyData.history || [];
        }
        
        if (favoritesResponse.ok) {
            const favoritesData = await favoritesResponse.json();
            gameFavorites = favoritesData.favorites || [];
        }
    } catch (error) {
        console.error('Error loading history/favorites:', error);
        showNotification('Failed to load history and favorites', 'error');
    }
    
    // Add click outside listeners for modals
    const historyModal = document.getElementById('gameHistoryModal');
    const favoritesModal = document.getElementById('gameFavoritesModal');
    
    window.addEventListener('click', (e) => {
        if (e.target === historyModal) {
            closeGameHistory();
        }
        if (e.target === favoritesModal) {
            closeGameFavorites();
        }
    });
    
    // Update the game list to show favorites
    updateGamesList();
});

// Game history functions
async function addToGameHistory(game) {
    try {
        const response = await fetch('/api/game-history', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: game.id,
                name: game.name,
                image: game.image
            })
        });

        if (response.ok) {
            const data = await response.json();
            gameHistory = data.history;
            updateGamesList();
        }
    } catch (error) {
        console.error('Error adding game to history:', error);
        showNotification('Failed to update history', 'error');
    }
}

function showGameHistory() {
    const modal = document.getElementById('gameHistoryModal');
    const historyList = document.getElementById('gameHistoryList');
    const historyCount = document.getElementById('historyCount');
    const startStopBtn = document.getElementById('historyStartStopAllBtn');
    
    historyList.innerHTML = '';
    
    // Update the count with proper singular/plural form
    const gameText = gameHistory.length === 1 ? 'game' : 'games';
    historyCount.textContent = `(${gameHistory.length} ${gameText})`;
    
    // Show/hide and update start/stop button
    if (gameHistory.length > 0) {
        startStopBtn.classList.remove('hidden');
        const allRunning = gameHistory.every(game => runningGames.has(game.id.toString()));
        updateStartStopButton(startStopBtn, allRunning);
    } else {
        startStopBtn.classList.add('hidden');
    }

    if (gameHistory.length === 0) {
        historyList.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <i class="fas fa-history text-4xl mb-4"></i>
                <p>No game history yet</p>
            </div>
        `;
    } else {
        gameHistory.forEach(game => {
            const isRunning = runningGames.has(game.id.toString());
            const isFavorite = gameFavorites.some(g => g.id === game.id);
            
            const div = document.createElement('div');
            div.className = 'bg-gray-700 p-4 rounded-lg hover:bg-gray-600 transition-colors';
            div.setAttribute('data-game-id', game.id);
            div.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4 flex-1">
                        <div class="relative">
                            <img src="${game.image || 'https://via.placeholder.com/460x215/374151/FFFFFF?text=No+Image'}" 
                                 alt="${game.name}" 
                                 class="w-16 h-16 rounded-lg object-cover">
                            ${isRunning ? '<span class="absolute top-0 left-0 bg-green-500 text-white px-2 py-1 rounded-tl-lg text-xs">Running</span>' : ''}
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center gap-2">
                                <h4 class="font-medium text-lg">${game.name}</h4>
                                <button onclick="toggleGameFavoriteFromHistory('${game.id}', '${game.name}', '${game.image}')" 
                                        class="text-2xl">
                                    <i class="fas fa-star ${isFavorite ? 'text-yellow-400 glow-yellow' : 'text-gray-500 hover:text-yellow-400'}"></i>
                                </button>
                            </div>
                            <div class="text-sm text-gray-400">Added ${formatTimeAgo(game.addedAt)}</div>
                        </div>
                    </div>
                    <div class="flex gap-2 items-center">
                        <button onclick="handleGameAction('${game.id}', ${isRunning})" 
                                class="game-action-btn bg-${isRunning ? 'red' : 'green'}-500 hover:bg-${isRunning ? 'red' : 'green'}-600 px-4 py-2 rounded text-sm font-medium transition-colors">
                            <i class="fas fa-${isRunning ? 'stop' : 'play'} mr-1"></i>${isRunning ? 'Stop' : 'Start'}
                        </button>
                        <button onclick="addGameFromHistory('${game.id}')" 
                                class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded text-sm font-medium transition-colors">
                            <i class="fas fa-plus mr-1"></i>Add
                        </button>
                        <button onclick="removeFromHistory('${game.id}')"
                                class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded text-sm font-medium transition-colors">
                            <i class="fas fa-trash mr-1"></i>
                        </button>
                    </div>
                </div>
            `;
            
            historyList.appendChild(div);
        });
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Add new function to handle favoriting from history
async function toggleGameFavoriteFromHistory(gameId, gameName, gameImage) {
    try {
        const response = await fetch('/api/game-favorites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: gameId,
                name: gameName,
                image: gameImage
            })
        });

        if (response.ok) {
            const data = await response.json();
            gameFavorites = data.favorites;
            showNotification(data.message, 'success');
            showGameHistory(); // Refresh the history view to update the favorite status
        }
    } catch (error) {
        console.error('Error toggling favorite:', error);
        showNotification('Failed to update favorites', 'error');
    }
}

function closeGameHistory() {
    const modal = document.getElementById('gameHistoryModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function addGameFromHistory(gameId) {
    try {
        const response = await fetch('/api/fetch-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId })
        });
        
        const gameInfo = await response.json();
        if (gameInfo.error) {
            showNotification(gameInfo.error, 'error');
            return;
        }
        
        addGameToList(gameInfo);
        closeGameHistory();
    } catch (error) {
        console.error('Error adding game from history:', error);
        showNotification('Failed to add game', 'error');
    }
}

async function removeFromHistory(gameId) {
    try {
        const response = await fetch('/api/game-history', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId })
        });

        if (response.ok) {
            const data = await response.json();
            gameHistory = data.history;
            showGameHistory(); // Refresh the history modal
            showNotification('Game removed from history', 'success');
        }
    } catch (error) {
        console.error('Error removing game from history:', error);
        showNotification('Failed to remove from history', 'error');
    }
}

// Game favorites functions
async function toggleGameFavorite(gameId) {
    const game = currentGames.find(g => g.id === gameId);
    if (!game) return;
    
    try {
        const response = await fetch('/api/game-favorites', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                id: game.id,
                name: game.name,
                image: game.image
            })
        });

        if (response.ok) {
            const data = await response.json();
            gameFavorites = data.favorites;
            showNotification(data.message, 'success');
            updateGamesList();
        }
    } catch (error) {
        console.error('Error toggling favorite:', error);
        showNotification('Failed to update favorites', 'error');
    }
}

function showGameFavorites() {
    const modal = document.getElementById('gameFavoritesModal');
    const favoritesList = document.getElementById('gameFavoritesList');
    const favoritesCount = document.getElementById('favoritesCount');
    const startStopBtn = document.getElementById('favoritesStartStopAllBtn');
    
    favoritesList.innerHTML = '';
    
    // Update the count with proper singular/plural form
    const gameText = gameFavorites.length === 1 ? 'game' : 'games';
    favoritesCount.textContent = `(${gameFavorites.length} ${gameText})`;
    
    // Show/hide and update start/stop button
    if (gameFavorites.length > 0) {
        startStopBtn.classList.remove('hidden');
        const allRunning = gameFavorites.every(game => runningGames.has(game.id.toString()));
        updateStartStopButton(startStopBtn, allRunning);
    } else {
        startStopBtn.classList.add('hidden');
    }

    if (gameFavorites.length === 0) {
        favoritesList.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <i class="fas fa-star text-4xl mb-4"></i>
                <p>No favorite games yet</p>
            </div>
        `;
    } else {
        gameFavorites.forEach(game => {
            const isRunning = runningGames.has(game.id.toString());
            
            const div = document.createElement('div');
            div.className = 'bg-gray-700 p-4 rounded-lg hover:bg-gray-600 transition-colors';
            div.setAttribute('data-game-id', game.id);
            div.innerHTML = `
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4 flex-1">
                        <div class="relative">
                            <img src="${game.image || 'https://via.placeholder.com/460x215/374151/FFFFFF?text=No+Image'}" 
                                 alt="${game.name}" 
                                 class="w-16 h-16 rounded-lg object-cover">
                            ${isRunning ? '<span class="absolute top-0 left-0 bg-green-500 text-white px-2 py-1 rounded-tl-lg text-xs">Running</span>' : ''}
                        </div>
                        <div class="flex-1">
                            <div class="flex items-center gap-2">
                                <h4 class="font-medium text-lg">${game.name}</h4>
                                <i class="fas fa-star text-yellow-500 glow-yellow"></i>
                            </div>
                            <div class="text-sm text-gray-400 mt-1">Game ID: ${game.id}</div>
                            <div class="text-sm text-gray-400">Added ${formatTimeAgo(game.addedAt)}</div>
                        </div>
                    </div>
                    <div class="flex gap-2 items-center">
                        <button onclick="handleGameAction('${game.id}', ${isRunning})" 
                                class="game-action-btn bg-${isRunning ? 'red' : 'green'}-500 hover:bg-${isRunning ? 'red' : 'green'}-600 px-4 py-2 rounded text-sm font-medium transition-colors">
                            <i class="fas fa-${isRunning ? 'stop' : 'play'} mr-1"></i>${isRunning ? 'Stop' : 'Start'}
                        </button>
                        <button onclick="addGameFromFavorites('${game.id}')" 
                                class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded text-sm font-medium transition-colors">
                            <i class="fas fa-plus mr-1"></i>Add
                        </button>
                        <button onclick="removeFromFavorites('${game.id}')"
                                class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded text-sm font-medium transition-colors">
                            <i class="fas fa-trash mr-1"></i>
                        </button>
                    </div>
                </div>
            `;
            
            favoritesList.appendChild(div);
        });
    }
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeGameFavorites() {
    const modal = document.getElementById('gameFavoritesModal');
    modal.classList.remove('flex');
    modal.classList.add('hidden');
}

async function addGameFromFavorites(gameId) {
    try {
        const response = await fetch('/api/fetch-game', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId })
        });
        
        const gameInfo = await response.json();
        if (gameInfo.error) {
            showNotification(gameInfo.error, 'error');
            return;
        }
        
        addGameToList(gameInfo);
        closeGameFavorites();
    } catch (error) {
        console.error('Error adding game from favorites:', error);
        showNotification('Failed to add game', 'error');
    }
}

async function removeFromFavorites(gameId) {
    try {
        const response = await fetch('/api/game-favorites', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ gameId })
        });

        if (response.ok) {
            const data = await response.json();
            gameFavorites = data.favorites;
            showGameFavorites(); // Refresh the favorites modal
            updateGamesList(); // Update the main game list to reflect favorite status
            showNotification('Game removed from favorites', 'success');
        }
    } catch (error) {
        console.error('Error removing game from favorites:', error);
        showNotification('Failed to remove from favorites', 'error');
    }
}

// Helper function to format time ago
function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

// Add a function to refresh the presets cache
async function refreshPresetsCache() {
    try {
        const response = await fetch('/api/get-presets');
        const presets = await response.json();
        presetsCache = presets;
        return presets;
    } catch (error) {
        console.error('Error refreshing presets cache:', error);
        return null;
    }
}

function clearAllGames() {
    if (currentGames.length === 0) {
        showNotification('No games to clear', 'info');
        return;
    }

    // Check if any games are running
    const runningGameCount = currentGames.filter(game => runningGames.has(game.id.toString())).length;
    if (runningGameCount > 0) {
        showNotification('Please stop all running games before clearing', 'error');
        return;
    }

    currentGames = [];
    updateGamesList();
    showNotification('All games cleared', 'success');
}

// ... existing code ...

// Function to update playtimes for running games
async function updateGamePlaytimes() {
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
        } catch (error) {
            console.error('Error updating playtime:', error);
        }
    }
}

// Start updating playtimes periodically
setInterval(updateGamePlaytimes, 1000);

// ... existing code ...

async function importGamesFromFile(file) {
    const loadingOverlay = document.getElementById('gameImportLoadingOverlay');
    loadingOverlay.classList.remove('hidden');
    const statusText = document.getElementById('gameImportStatus');
    
    try {
        statusText.textContent = 'Analyzing file...';
        
        const reader = new FileReader();
        reader.onload = async function() {
            try {
                const content = reader.result;
                let gameIds = [];
                
                // Check file type and parse accordingly
                if (file.name.endsWith('.bat')) {
                    // Parse BAT file for steam-idle.exe commands
                    const matches = content.match(/steam-idle\.exe\s+(\d+)/g);
                    if (matches) {
                        gameIds = matches.map(match => match.match(/\d+/)[0]);
                    }
                } else {
                    // Parse TXT file - split by newlines and clean up each line
                    const lines = content.split(/\r?\n/).filter(line => line.trim());
                    
                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (/^\d+$/.test(trimmedLine)) {
                            // Line contains only numbers - treat as game ID
                            gameIds.push(trimmedLine);
                        } else if (trimmedLine) {
                            // Line contains text - treat as game name
                            statusText.textContent = `Searching for game: ${trimmedLine}...`;
                            try {
                                const searchResponse = await fetch('/api/fetch-game', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ gameId: trimmedLine })
                                });
                                
                                if (searchResponse.ok) {
                                    const gameInfo = await searchResponse.json();
                                    if (gameInfo && gameInfo.id) {
                                        gameIds.push(gameInfo.id.toString());
                                    }
                                }
                                // Add delay between searches
                                await new Promise(resolve => setTimeout(resolve, 500));
                            } catch (error) {
                                console.warn(`Could not find game: ${trimmedLine}`, error);
                            }
                        }
                    }
                }
                
                if (gameIds.length === 0) {
                    throw new Error('No valid game IDs or names found in the file');
                }
                
                // Fetch info for each game and add to list
                const uniqueGameIds = [...new Set(gameIds)]; // Remove duplicates
                let addedGames = 0;
                let failedGames = 0;
                
                for (let i = 0; i < uniqueGameIds.length; i++) {
                    statusText.textContent = `Adding game (${i + 1}/${uniqueGameIds.length})...`;
                    
                    try {
                        const response = await fetch('/api/fetch-game', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ gameId: uniqueGameIds[i] })
                        });
                        
                        if (response.ok) {
                            const gameInfo = await response.json();
                            // Check if game already exists
                            if (!document.querySelector(`[data-game-id="${gameInfo.id}"]`)) {
                                addGameToList(gameInfo);
                                // Add to history
                                await addToGameHistory(gameInfo);
                                addedGames++;
                            } else {
                                failedGames++;
                                console.log(`Game ${gameInfo.name} (${gameInfo.id}) already exists`);
                            }
                        } else {
                            failedGames++;
                            console.warn(`Failed to fetch game info for ID: ${uniqueGameIds[i]}`);
                        }
                    } catch (error) {
                        failedGames++;
                        console.error(`Error adding game ${uniqueGameIds[i]}:`, error);
                    }
                    
                    // Add delay to prevent overwhelming Steam API
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // Show detailed success/failure notification
                if (addedGames > 0) {
                    let message = `Successfully imported ${addedGames} games`;
                    if (failedGames > 0) {
                        message += ` (${failedGames} skipped/failed)`;
                    }
                    showNotification(message, 'success');
                } else {
                    showNotification('No new games were imported. They may already exist in your list.', 'warning');
                }
                
            } catch (error) {
                console.error('Error processing file:', error);
                showNotification(error.message || 'Failed to process file', 'error');
            } finally {
                loadingOverlay.classList.add('hidden');
            }
        };
        
        reader.onerror = function() {
            loadingOverlay.classList.add('hidden');
            showNotification('Error reading file', 'error');
        };
        
        reader.readAsText(file);
        
    } catch (error) {
        console.error('Error importing file:', error);
        showNotification('Failed to import file', 'error');
        loadingOverlay.classList.add('hidden');
    }
}

// ... existing code ...

// Add event listeners when document is ready
document.addEventListener('DOMContentLoaded', function() {
    // ... existing event listeners ...

    // Game import file listener
    const gameImportFile = document.getElementById('gameImportFile');
    if (gameImportFile) {
        gameImportFile.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                importGamesFromFile(e.target.files[0]);
                e.target.value = ''; // Reset file input
            }
        });
    }

    // ... existing code ...
});

// Add this function to handle starting/stopping all games
async function toggleAllGames() {
    const startStopAllBtn = document.getElementById('startStopAllBtn');
    const allGamesRunning = currentGames.every(game => runningGames.has(game.id.toString()));
    
    if (allGamesRunning) {
        // Stop all games
        for (const game of currentGames) {
            await stopGame(game.id);
        }
    } else {
        // Start all games
        for (const game of currentGames) {
            if (!runningGames.has(game.id.toString())) {
                await startGame(game.id);
            }
        }
    }
    
    // Update UI
    updateGamesList();
}

function toggleExportCustomization() {
    const popup = document.getElementById('exportCustomizationPopup');
    if (popup.classList.contains('hidden')) {
        loadExportPreferences();
        popup.classList.remove('hidden');
        popup.classList.add('flex');
    } else {
        saveExportPreferences();
        popup.classList.remove('flex');
        popup.classList.add('hidden');
    }
}

async function saveExportPreferences() {
    const preferences = {
        game_id: document.getElementById('export_game_id').checked,
        game_name: document.getElementById('export_game_name').checked,
        store_url: document.getElementById('export_store_url').checked,
        time_hhmmss: document.getElementById('export_time_hhmmss').checked,
        hours: document.getElementById('export_hours').checked,
        percentage: document.getElementById('export_percentage').checked,
        rank: document.getElementById('export_rank').checked,
        status: document.getElementById('export_status').checked,
        session: document.getElementById('export_session').checked,
        favorite: document.getElementById('export_favorite').checked
    };
    
    try {
        const response = await fetch('/api/export-preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(preferences)
        });
        
        if (response.ok) {
            showNotification('Export preferences saved successfully', 'success');
        } else {
            throw new Error('Failed to save export preferences');
        }
    } catch (error) {
        console.error('Error saving export preferences:', error);
        showNotification('Failed to save export preferences', 'error');
    }
}

async function loadExportPreferences() {
    try {
        const response = await fetch('/api/export-preferences');
        if (response.ok) {
            const preferences = await response.json();
            document.getElementById('export_game_id').checked = preferences.game_id;
            document.getElementById('export_game_name').checked = preferences.game_name;
            document.getElementById('export_store_url').checked = preferences.store_url;
            document.getElementById('export_time_hhmmss').checked = preferences.time_hhmmss;
            document.getElementById('export_hours').checked = preferences.hours;
            document.getElementById('export_percentage').checked = preferences.percentage;
            document.getElementById('export_rank').checked = preferences.rank;
            document.getElementById('export_status').checked = preferences.status;
            document.getElementById('export_session').checked = preferences.session;
            document.getElementById('export_favorite').checked = preferences.favorite;
        } else {
            throw new Error('Failed to load export preferences');
        }
    } catch (error) {
        console.error('Error loading export preferences:', error);
        showNotification('Failed to load export preferences', 'error');
    }
}

function toggleExportCustomization() {
    const popup = document.getElementById('exportCustomizationPopup');
    if (popup.classList.contains('hidden')) {
        loadExportPreferences();
        popup.classList.remove('hidden');
        popup.classList.add('flex');
    } else {
        saveExportPreferences();
        popup.classList.remove('flex');
        popup.classList.add('hidden');
    }
}

// ... existing code ...
async function resetExportPreferences() {
    // Default preferences
    const defaultPreferences = {
        game_id: true,
        game_name: true,
        store_url: false,
        time_hhmmss: true,
        hours: true,
        percentage: false,
        rank: true,
        status: false,
        session: false,
        favorite: false
    };

    // Update checkboxes
    for (const [key, value] of Object.entries(defaultPreferences)) {
        document.getElementById(`export_${key}`).checked = value;
    }

    // Save to backend
    try {
        const response = await fetch('/api/export-preferences', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(defaultPreferences)
        });

        if (response.ok) {
            showNotification('Export preferences reset to default', 'success');
        } else {
            showNotification('Failed to reset preferences', 'error');
        }
    } catch (error) {
        console.error('Error resetting export preferences:', error);
        showNotification('Failed to reset preferences', 'error');
    }
}

// ... existing code ...

// ... existing code ...
async function exportPreset(presetName, exportType) {
    try {
        // Get the preset data
        const presets = await loadPresets(true);
        const preset = presets.find(p => p.name === presetName);
        
        if (!preset) {
            showNotification('Preset not found', 'error');
            return;
        }

        // Create content based on export type
        let content = '';
        if (exportType === 'ids') {
            content = preset.games.map(game => game.id).join('\n');
        } else {
            content = preset.games.map(game => game.name).join('\n');
        }

        // Get number of games
        const gameCount = preset.games.length;

        // Create and trigger download
        const blob = new Blob([content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${presetName}_${exportType === 'ids' ? 'ids' : 'names'}_${gameCount}.txt`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showNotification(`Preset exported as ${exportType === 'ids' ? 'Game IDs' : 'Game Names'} (${gameCount} games)`, 'success');
    } catch (error) {
        console.error('Error exporting preset:', error);
        showNotification('Failed to export preset', 'error');
    }
}

// ... existing code ...

// Add the exportGames function
async function exportGames(exportType) {
    try {
        // Get number of games
        const gameCount = currentGames.length;

        // Create content based on export type
        let content = '';
        if (exportType === 'ids') {
            content = currentGames.map(game => game.id).join('\n');
        } else {
            content = currentGames.map(game => game.name).join('\n');
        }

        // Create and trigger download
        const blob = new Blob([content], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `games_${exportType === 'ids' ? 'ids' : 'names'}_${gameCount}.txt`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showNotification(`Games exported as ${exportType === 'ids' ? 'Game IDs' : 'Game Names'} (${gameCount} games)`, 'success');
    } catch (error) {
        console.error('Error exporting games:', error);
        showNotification('Failed to export games', 'error');
    }
}

async function stopAllGamesSequentially() {
    const gamesList = document.getElementById('runningGamesList');
    if (!gamesList) return;

    // Check if there are any running games
    const runningGameIds = Array.from(runningGames);
    if (runningGameIds.length === 0) {
        showNotification('No games running to stop', 'info');
        return;
    }

    // Disable both stop buttons while the operation is in progress
    const stopButton = document.querySelector('button[onclick="stopAllGamesSequentially()"]');
    const emergencyStopButton = document.querySelector('button[onclick="showEmergencyStopConfirmation()"]');
    stopButton.disabled = true;
    emergencyStopButton.disabled = true;

    // Add loading state to the button
    const originalButtonText = stopButton.innerHTML;
    stopButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Stopping Games...';

    try {
        for (let i = 0; i < runningGameIds.length; i++) {
            const gameId = runningGameIds[i];
            await stopGame(gameId);
            
            // Show progress in the button text
            const remainingGames = runningGameIds.length - (i + 1);
            stopButton.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>Stopping Games (${remainingGames} remaining)`;
            
            // Add a small delay between stopping each game
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        showNotification('All games have been stopped successfully', 'success');
    } catch (error) {
        console.error('Error stopping games:', error);
        showNotification('Failed to stop all games', 'error');
    } finally {
        // Re-enable buttons and restore original text
        stopButton.disabled = false;
        emergencyStopButton.disabled = false;
        stopButton.innerHTML = originalButtonText;
        
        // Update the running games list
        updateRunningGamesList();
    }
}

// Helper function to update start/stop button appearance
function updateStartStopButton(button, isRunning) {
    const icon = button.querySelector('i');
    const tooltip = button.querySelector('.opacity-0');
    
    if (isRunning) {
        button.classList.remove('hover:text-green-500');
        button.classList.add('hover:text-red-500');
        button.classList.add('text-red-500');
        icon.classList.remove('fa-play');
        icon.classList.add('fa-stop');
        tooltip.textContent = 'Stop All Games';
    } else {
        button.classList.add('hover:text-green-500');
        button.classList.remove('hover:text-red-500');
        button.classList.remove('text-red-500');
        icon.classList.add('fa-play');
        icon.classList.remove('fa-stop');
        tooltip.textContent = 'Start All Games';
    }
}

// Function to toggle all games in history
async function toggleAllHistoryGames() {
    const allRunning = gameHistory.every(game => runningGames.has(game.id.toString()));
    const button = document.getElementById('historyStartStopAllBtn');
    
    if (allRunning) {
        // Stop all running games
        for (const game of gameHistory) {
            if (runningGames.has(game.id.toString())) {
                await stopGame(game.id);
            }
        }
    } else {
        // Start all games that aren't running
        for (const game of gameHistory) {
            if (!runningGames.has(game.id.toString())) {
                await startGame(game.id);
            }
        }
    }
    
    // Update the button state
    const newAllRunning = gameHistory.every(game => runningGames.has(game.id.toString()));
    updateStartStopButton(button, newAllRunning);
    
    // Refresh the history view
    showGameHistory();
}

// Function to toggle all games in favorites
async function toggleAllFavoriteGames() {
    const allRunning = gameFavorites.every(game => runningGames.has(game.id.toString()));
    const button = document.getElementById('favoritesStartStopAllBtn');
    
    if (allRunning) {
        // Stop all running games
        for (const game of gameFavorites) {
            if (runningGames.has(game.id.toString())) {
                await stopGame(game.id);
            }
        }
    } else {
        // Start all games that aren't running
        for (const game of gameFavorites) {
            if (!runningGames.has(game.id.toString())) {
                await startGame(game.id);
            }
        }
    }
    
    // Update the button state
    const newAllRunning = gameFavorites.every(game => runningGames.has(game.id.toString()));
    updateStartStopButton(button, newAllRunning);
    
    // Refresh the favorites view
    showGameFavorites();
}

// New function to handle game actions and update UI
async function handleGameAction(gameId, isRunning) {
    try {
        if (isRunning) {
            await stopGame(gameId);
        } else {
            await startGame(gameId);
        }
        
        // Update both modals if they're open
        if (!document.getElementById('gameHistoryModal').classList.contains('hidden')) {
            showGameHistory();
        }
        if (!document.getElementById('gameFavoritesModal').classList.contains('hidden')) {
            showGameFavorites();
        }
        
        // Update the main games list
        updateGamesList();
    } catch (error) {
        console.error('Error handling game action:', error);
        showNotification('Failed to perform game action', 'error');
    }
}

async function addAllFromHistory() {
    if (gameHistory.length === 0) {
        showNotification('No games in history to add', 'info');
        return;
    }

    let addedCount = 0;
    let duplicateCount = 0;
    const totalGames = gameHistory.length;

    // Show initial loading notification
    showNotification('Adding games from history...', 'info');

    for (const game of gameHistory) {
        if (currentGames.some(g => g.id === game.id)) {
            duplicateCount++;
            continue;
        }

        try {
            const response = await fetch('/api/fetch-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId: game.id })
            });
            
            const gameInfo = await response.json();
            if (!gameInfo.error) {
                currentGames.push(gameInfo);
                addedCount++;
                // Show progress notification
                showNotification(`Adding games: ${addedCount + duplicateCount}/${totalGames}`, 'info');
            }
        } catch (error) {
            console.error('Error adding game from history:', error);
        }
    }

    updateGamesList();
    // Show final success notification
    showNotification(`Added ${addedCount} games${duplicateCount > 0 ? ` (${duplicateCount} duplicates skipped)` : ''}`, 'success');
    closeGameHistory();
}

async function addAllFromFavorites() {
    if (gameFavorites.length === 0) {
        showNotification('No favorite games to add', 'info');
        return;
    }

    let addedCount = 0;
    let duplicateCount = 0;
    const totalGames = gameFavorites.length;

    // Show initial loading notification
    showNotification('Adding games from favorites...', 'info');

    for (const game of gameFavorites) {
        if (currentGames.some(g => g.id === game.id)) {
            duplicateCount++;
            continue;
        }

        try {
            const response = await fetch('/api/fetch-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId: game.id })
            });
            
            const gameInfo = await response.json();
            if (!gameInfo.error) {
                currentGames.push(gameInfo);
                addedCount++;
                // Show progress notification
                showNotification(`Adding games: ${addedCount + duplicateCount}/${totalGames}`, 'info');
            }
        } catch (error) {
            console.error('Error adding game from favorites:', error);
        }
    }

    updateGamesList();
    // Show final success notification
    showNotification(`Added ${addedCount} games${duplicateCount > 0 ? ` (${duplicateCount} duplicates skipped)` : ''}`, 'success');
    closeGameFavorites();
}

function showClearHistoryConfirmation() {
    if (gameHistory.length === 0) {
        showNotification('No games in history to clear', 'info');
        return;
    }
    const modal = document.getElementById('clearHistoryConfirmModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeClearHistoryConfirmation() {
    const modal = document.getElementById('clearHistoryConfirmModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function clearAllHistory() {
    try {
        const response = await fetch('/api/game-history', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ clearAll: true })
        });

        if (response.ok) {
            gameHistory = [];
            showGameHistory(); // Refresh the history view
            showNotification('Game history cleared successfully', 'success');
            closeClearHistoryConfirmation();
        }
    } catch (error) {
        console.error('Error clearing history:', error);
        showNotification('Failed to clear history', 'error');
    }
}

function showClearFavoritesConfirmation() {
    if (gameFavorites.length === 0) {
        showNotification('No favorite games to clear', 'info');
        return;
    }
    const modal = document.getElementById('clearFavoritesConfirmModal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeClearFavoritesConfirmation() {
    const modal = document.getElementById('clearFavoritesConfirmModal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

async function clearAllFavorites() {
    try {
        const response = await fetch('/api/game-favorites', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ clearAll: true })
        });

        if (response.ok) {
            gameFavorites = [];
            showGameFavorites(); // Refresh the favorites view
            updateGamesList(); // Update the main game list to reflect favorite status
            showNotification('Favorite games cleared successfully', 'success');
            closeClearFavoritesConfirmation();
        }
    } catch (error) {
        console.error('Error clearing favorites:', error);
        showNotification('Failed to clear favorites', 'error');
    }
}

// Add click outside listeners for the confirmation modals
document.addEventListener('DOMContentLoaded', function() {
    const clearHistoryModal = document.getElementById('clearHistoryConfirmModal');
    const clearFavoritesModal = document.getElementById('clearFavoritesConfirmModal');
    
    window.addEventListener('click', (e) => {
        if (e.target === clearHistoryModal) {
            closeClearHistoryConfirmation();
        }
        if (e.target === clearFavoritesModal) {
            closeClearFavoritesConfirmation();
        }
    });
});