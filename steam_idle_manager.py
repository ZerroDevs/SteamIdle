import os
import sys
import json
import subprocess
import webview
import requests
import psutil
import winreg
import socket
from flask import Flask, render_template, request, jsonify, send_file
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import pystray
from PIL import Image
import threading
from pypresence import Presence
import time
import asyncio
import nest_asyncio
import csv
import re
import win32gui
import win32con
import win32process

# Try to patch asyncio to allow nested event loops
try:
    nest_asyncio.apply()
except Exception:
    pass

# Initialize Flask app
app = Flask(__name__)

# Global variables
icon = None
IDLER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "steam-idle.exe")
minimize_to_tray = False
AUTO_RECONNECT = False
DISCORD_RPC = None
DISCORD_RPC_ENABLED = True  # Default enabled

# Discord RPC Client ID
DISCORD_CLIENT_ID = '1341211129153716316'

# Set up AppData paths
APPDATA_PATH = os.path.join(os.getenv('APPDATA'), 'SteamIdler')
PRESETS_DIR = os.path.join(APPDATA_PATH, "presets")
STATS_FILE = os.path.join(APPDATA_PATH, "stats.json")
SETTINGS_FILE = os.path.join(APPDATA_PATH, "settings.json")

# Add new constants after existing constants
FAVORITES_FILE = os.path.join(APPDATA_PATH, "favorites.json")
RECENT_ACTIONS_FILE = os.path.join(APPDATA_PATH, "recent_actions.json")
SHORTCUTS_FILE = os.path.join(APPDATA_PATH, "shortcuts.json")

# Add new constants
RECONNECT_INTERVAL = 300  # 5 minutes in seconds

# Add new constants after existing constants
HISTORY_FILE = os.path.join(APPDATA_PATH, "game_history.json")
GAME_FAVORITES_FILE = os.path.join(APPDATA_PATH, "game_favorites.json")

# Create necessary directories if they don't exist
if not os.path.exists(APPDATA_PATH):
    os.makedirs(APPDATA_PATH)
if not os.path.exists(PRESETS_DIR):
    os.makedirs(PRESETS_DIR)

running_games = {}
game_sessions = {}  # Store game session data: {game_id: {'start_time': datetime, 'total_time': seconds}}

def initialize_discord_rpc():
    global DISCORD_RPC
    try:
        if DISCORD_RPC:
            try:
                DISCORD_RPC.close()
            except:
                pass
        DISCORD_RPC = Presence(DISCORD_CLIENT_ID)
        DISCORD_RPC.connect()
        update_discord_rpc()
    except Exception as e:
        print(f"Failed to initialize Discord RPC: {e}")
        DISCORD_RPC = None

def update_discord_rpc():
    """Update Discord Rich Presence status"""
    global DISCORD_RPC
    
    if not DISCORD_RPC_ENABLED:
        return
        
    try:
        if not DISCORD_RPC:
            initialize_discord_rpc()
            if not DISCORD_RPC:  # If initialization failed
                return

        # Get total playtime and running games
        total_playtime = 0
        current_session_playtime = 0
        first_start_time = None
        running_game_names = []

        # Calculate total playtime only for running games
        for game_id in running_games.keys():
            if game_id in game_sessions:
                session = game_sessions[game_id]
                # Add completed session time for this game
                total_playtime += session.get('total_time', 0)
                
                # Add current session time
                if 'start_time' in session:
                    current_session = (datetime.now() - session['start_time']).total_seconds()
                    current_session_playtime += current_session
                    total_playtime += current_session
                    if not first_start_time or session['start_time'] < first_start_time:
                        first_start_time = session['start_time']
                    running_game_names.append(session.get('name', f'Game {game_id}'))

        # Set the status based on whether games are running
        if running_game_names:
            details = f"🎮 Idling {len(running_game_names)} games"
            state = f"🕒 Session: {format_duration(int(current_session_playtime))} 📅 Total: {format_duration(int(total_playtime))}"
            try:
                DISCORD_RPC.update(
                    large_image="Logo1",
                    large_text="Steam Idle Manager",
                    small_image="orange",  # Show orange status when games are running
                    small_text=f"🎮 Idling {len(running_game_names)}",
                    details=details,
                    state=state,
                    start=int(first_start_time.timestamp()) if first_start_time else None
                )
            except Exception as e:
                if "pipe" in str(e).lower() or "client" in str(e).lower():
                    DISCORD_RPC = None
                    time.sleep(1)
                    initialize_discord_rpc()
        else:
            # Check Steam status when no games are running
            steam_status = check_steam_status()
            status_text = "🚫 Steam is not running"
            small_image = "offline"
            details = "🚫 Not ready to idle"  # Default to not ready
            
            if steam_status["running"]:
                if steam_status["online"]:
                    status_text = "🌐 Steam is online"
                    small_image = "online"
                    details = "✅ Ready to idle"  # Only ready when Steam is online
                else:
                    status_text = "📴 Steam is offline"
                    small_image = "offline"
            
            try:
                DISCORD_RPC.update(
                    large_image="Logo1",
                    large_text="Steam Idle Manager",
                    small_image=small_image,
                    small_text=status_text,
                    details=details,
                    state=f"📝 {status_text}"
                )
            except Exception as e:
                if "pipe" in str(e).lower() or "client" in str(e).lower():
                    DISCORD_RPC = None
                    time.sleep(1)
                    initialize_discord_rpc()
    except Exception as e:
        print(f"Failed to update Discord RPC: {e}")
        if "pipe" in str(e).lower() or "client" in str(e).lower():
            DISCORD_RPC = None
            time.sleep(1)
            initialize_discord_rpc()

def discord_rpc_thread():
    """Thread to update Discord Rich Presence status"""
    while True:
        try:
            if DISCORD_RPC_ENABLED:
                update_discord_rpc()
        except Exception as e:
            print(f"Error in Discord RPC thread: {e}")
        time.sleep(15)  # Update every 15 seconds

# Start the Discord RPC thread
discord_thread = threading.Thread(target=discord_rpc_thread)
discord_thread.daemon = True
discord_thread.start()

def resource_path(relative_path):
    """Get absolute path to resource, works for dev and for PyInstaller"""
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

def load_settings():
    """Load settings from the settings file"""
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, 'r') as f:
                settings = json.load(f)
                # Update IDLER_PATH if it was previously configured
                global IDLER_PATH, minimize_to_tray, AUTO_RECONNECT, DISCORD_RPC_ENABLED
                
                # First check if there's a valid saved path
                if 'idler_path' in settings and os.path.exists(settings['idler_path']):
                    IDLER_PATH = settings['idler_path']
                    settings['setup_completed'] = True
                # Then check if default path exists
                elif os.path.exists(IDLER_PATH):
                    settings['idler_path'] = IDLER_PATH
                    settings['setup_completed'] = True
                    # Save the settings since we found the default path
                    save_settings(settings)
                else:
                    settings['setup_completed'] = False
                    settings['idler_path'] = None
                
                # Load minimize to tray setting
                minimize_to_tray = settings.get('minimize_to_tray', False)
                
                # Load auto reconnect setting
                AUTO_RECONNECT = settings.get('auto_reconnect', False)
                
                # Load Discord RPC setting (default to True if not set)
                DISCORD_RPC_ENABLED = settings.get('discord_rpc_enabled', True)
                
                # Ensure theme setting exists
                if 'theme' not in settings:
                    settings['theme'] = 'dark'  # Default theme
                    save_settings(settings)
                
                return settings
        except Exception as e:
            print(f"Error loading settings: {e}")
            return {'setup_completed': False, 'theme': 'dark', 'discord_rpc_enabled': True}
    return {'setup_completed': False, 'theme': 'dark', 'discord_rpc_enabled': True}

def save_settings(settings):
    try:
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings, f)
        return True
    except Exception as e:
        print(f"Error saving settings: {e}")
        return False

def select_idle_executable():
    """Show file dialog to select steam-idle.exe"""
    try:
        # Use webview's file dialog instead of tkinter
        file_path = window.create_file_dialog(
            webview.OPEN_DIALOG,
            directory='',
            file_types=('Executable files (*.exe)', 'All files (*.*)')
        )
        
        # If user cancels or no file selected
        if not file_path or len(file_path) == 0:
            return None
            
        # Get the selected file path
        file_path = file_path[0]
        
        # Verify the selected file is actually steam-idle.exe
        if os.path.basename(file_path).lower() != "steam-idle.exe":
            return None
        
        return file_path
        
    except Exception as e:
        print(f"Error in file selection: {e}")
        return None

def check_idler_executable():
    """Check if steam-idle.exe exists and is configured"""
    global IDLER_PATH
    settings = load_settings()
    
    # If we have a valid saved path, use it
    if 'idler_path' in settings and os.path.exists(settings['idler_path']):
        IDLER_PATH = settings['idler_path']
        return True
        
    # If the default path exists, save it and use it
    if os.path.exists(IDLER_PATH):
        settings['idler_path'] = IDLER_PATH
        settings['setup_completed'] = True
        save_settings(settings)
        return True
    
    return False

def load_statistics():
    if os.path.exists(STATS_FILE):
        try:
            with open(STATS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {"game_sessions": {}}
    return {"game_sessions": {}}

def save_statistics():
    stats_data = {
        "game_sessions": {
            game_id: {
                "total_time": session.get('total_time', 0),
                "name": session.get('name', 'Unknown Game'),
                "image": session.get('image', '')
            }
            for game_id, session in game_sessions.items()
        }
    }
    with open(STATS_FILE, 'w') as f:
        json.dump(stats_data, f)

# Load saved statistics when starting up
saved_stats = load_statistics()
game_sessions = {
    game_id: {
        'total_time': data['total_time'],
        'name': data['name'],
        'image': data['image']
    }
    for game_id, data in saved_stats['game_sessions'].items()
}

def get_steam_path():
    try:
        # Try to get Steam path from registry
        hkey = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, "SOFTWARE\\WOW6432Node\\Valve\\Steam")
        steam_path = winreg.QueryValueEx(hkey, "InstallPath")[0]
        winreg.CloseKey(hkey)
        return steam_path
    except:
        # Default Steam paths if registry fails
        default_paths = [
            "C:\\Program Files (x86)\\Steam",
            "C:\\Program Files\\Steam",
        ]
        for path in default_paths:
            if os.path.exists(path):
                return path
    return None

def is_steam_running():
    for proc in psutil.process_iter(['name']):
        try:
            if proc.name().lower() == 'steam.exe':
                return True
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return False

def check_steam_status():
    if not is_steam_running():
        return {
            "running": False,
            "online": False,
            "message": "🚫 Steam is not running"
        }
    
    # Check if Steam is online by attempting to access the Steam Web API
    try:
        response = requests.get("https://steamcommunity.com/", timeout=5)
        if response.status_code == 200:
            return {
                "running": True,
                "online": True,
                "message": "🌐 Steam is running and online"
            }
        else:
            return {
                "running": True,
                "online": False,
                "message": "📴 Steam is running but appears to be offline"
            }
    except:
        return {
            "running": True,
            "online": False,
            "message": "📴 Steam is running but appears to be offline"
        }

def launch_steam():
    steam_path = get_steam_path()
    if steam_path:
        try:
            steam_exe = os.path.join(steam_path, "Steam.exe")
            if os.path.exists(steam_exe):
                subprocess.Popen([steam_exe])
                return True
        except Exception as e:
            print(f"Error launching Steam: {e}")
    return False

def format_duration(seconds):
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    seconds = seconds % 60
    return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}"

def fetch_game_info(game_input):
    try:
        # Check if input is a numeric ID
        if game_input.isdigit():
            game_id = game_input
            url = f"https://store.steampowered.com/app/{game_id}"
        else:
            # Search by game name
            search_url = f"https://store.steampowered.com/search/?term={requests.utils.quote(game_input)}"
            search_response = requests.get(search_url)
            search_soup = BeautifulSoup(search_response.text, 'html.parser')
            
            # Find the first search result
            first_result = search_soup.find('a', {'class': 'search_result_row'})
            if not first_result:
                return {"error": "🚫 Game not found"}
            
            game_id = first_result['data-ds-appid']
            url = f"https://store.steampowered.com/app/{game_id}"

        response = requests.get(url)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        game_name = soup.find('div', {'class': 'apphub_AppName'})
        game_name = game_name.text if game_name else "Unknown Game"
        
        game_image = soup.find('img', {'class': 'game_header_image_full'})
        game_image = game_image['src'] if game_image else ""
        
        return {
            "id": game_id,
            "name": game_name,
            "image": game_image
        }
    except Exception as e:
        return {"error": "❌ Error fetching game info"}

@app.route('/')
def home():
    """Serve the main application page"""
    settings = load_settings()
    return render_template('index.html', theme=settings.get('theme', 'dark'))

@app.route('/api/fetch-game', methods=['POST'])
def fetch_game():
    data = request.get_json()
    game_input = data.get('gameId')
    if not game_input:
        return jsonify({"error": "🚫 Please provide a game ID or name"})
    return jsonify(fetch_game_info(game_input))

@app.route('/api/save-preset', methods=['POST'])
def save_preset():
    data = request.get_json()
    preset_name = data.get('name')
    games = data.get('games', [])
    
    # Save preset as JSON
    preset_json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
    with open(preset_json_path, 'w') as f:
        json.dump(games, f)
    
    # Create BAT file in the same directory
    bat_content = "@echo off\n"
    bat_content += f'cd "{os.path.dirname(IDLER_PATH)}"\n'  # Change to Idler directory
    for game in games:
        bat_content += f'start steam-idle.exe {game["id"]}\n'
    
    bat_path = os.path.join(PRESETS_DIR, f"{preset_name}.bat")
    with open(bat_path, 'w') as f:
        f.write(bat_content)
    
    return jsonify({"status": "success"})

@app.route('/api/get-presets')
def get_presets():
    presets = []
    for filename in os.listdir(PRESETS_DIR):
        if filename.endswith('.json'):
            preset_name = filename[:-5]
            with open(os.path.join(PRESETS_DIR, filename), 'r') as f:
                games = json.load(f)
            presets.append({
                "name": preset_name,
                "games": games
            })
    return jsonify(presets)

@app.route('/api/steam-status')
def steam_status():
    return jsonify(check_steam_status())

@app.route('/api/launch-steam')
def start_steam():
    success = launch_steam()
    return jsonify({
        "status": "success" if success else "error",
        "message": "🚀 Steam launch initiated" if success else "❌ Failed to launch Steam"
    })

@app.route('/api/start-game', methods=['POST'])
def start_game():
    data = request.get_json()
    game_id = str(data.get('gameId'))
    
    # Check Steam status first
    steam_status = check_steam_status()
    if not steam_status['running']:
        return jsonify({
            "status": "error", 
            "message": "🚫 Steam is not running. Please start Steam first.",
            "steam_status": steam_status
        }), 400
    
    if not steam_status['online']:
        return jsonify({
            "status": "error", 
            "message": "📡 Steam appears to be offline. Please ensure Steam is online.",
            "steam_status": steam_status
        }), 400
    
    # Check if game is already running
    if game_id in running_games:
        return jsonify({"status": "error", "message": "🚫 Game is already running"}), 400
    
    try:
        process = subprocess.Popen([IDLER_PATH, game_id], shell=True)
        running_games[game_id] = process.pid
        
        # Initialize or update game session
        if game_id not in game_sessions:
            game_info = fetch_game_info(game_id)
            game_sessions[game_id] = {
                'total_time': 0,
                'name': game_info['name'],
                'image': game_info['image']
            }
        game_sessions[game_id]['start_time'] = datetime.now()
        
        # Save statistics
        save_statistics()
        
        # Update tray menu
        update_tray_menu()
        
        return jsonify({"status": "success", "pid": process.pid})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/stop-game', methods=['POST'])
def stop_game():
    data = request.get_json()
    game_id = str(data.get('gameId'))
    
    if game_id not in running_games:
        return jsonify({"status": "error", "message": "🚫 Game is not running"}), 400
    
    try:
        pid = running_games[game_id]
        process = psutil.Process(pid)
        for child in process.children(recursive=True):
            child.terminate()
        process.terminate()
        
        # Update total playtime
        if game_id in game_sessions and 'start_time' in game_sessions[game_id]:
            session_duration = (datetime.now() - game_sessions[game_id]['start_time']).total_seconds()
            game_sessions[game_id]['total_time'] += session_duration
            game_sessions[game_id].pop('start_time', None)
            
            # Save statistics
            save_statistics()
        
        del running_games[game_id]
        
        # Update tray menu
        update_tray_menu()
        
        return jsonify({"status": "success"})
    except psutil.NoSuchProcess:
        # If process is already gone, just remove it from our tracking
        del running_games[game_id]
        update_tray_menu()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/game-status', methods=['POST'])
def game_status():
    data = request.get_json()
    game_id = str(data.get('gameId'))
    
    is_running = game_id in running_games
    if is_running:
        try:
            # Verify process is actually still running
            process = psutil.Process(running_games[game_id])
            if not process.is_running():
                del running_games[game_id]
                is_running = False
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            del running_games[game_id]
            is_running = False
    
    return jsonify({"status": "success", "running": is_running})

@app.route('/api/delete-preset', methods=['POST'])
def delete_preset():
    data = request.get_json()
    preset_name = data.get('name')
    
    json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
    bat_path = os.path.join(PRESETS_DIR, f"{preset_name}.bat")
    
    try:
        # Remove both files if they exist
        if os.path.exists(json_path):
            os.remove(json_path)
        if os.path.exists(bat_path): 
            os.remove(bat_path)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/game-session-time', methods=['POST'])
def game_session_time():
    data = request.get_json()
    game_id = str(data.get('gameId'))
    
    if game_id not in game_sessions:
        return jsonify({
            "current_session": "00:00:00",
            "total_time": "00:00:00"
        })
    
    session = game_sessions[game_id]
    total_seconds = session.get('total_time', 0)
    
    # Calculate current session time if game is running
    current_session_seconds = 0
    if game_id in running_games and 'start_time' in session:
        current_session_seconds = (datetime.now() - session['start_time']).total_seconds()
    
    return jsonify({
        "current_session": format_duration(current_session_seconds),
        "total_time": format_duration(total_seconds + current_session_seconds)
    })

@app.route('/api/run-preset', methods=['POST'])
def run_preset():
    data = request.get_json()
    preset_name = data.get('name')
    
    # Check Steam status first
    steam_status = check_steam_status()
    if not steam_status['running']:
        return jsonify({
            "status": "error", 
            "message": "🚫 Steam is not running. Please start Steam first.",
            "steam_status": steam_status
        }), 400
    
    if not steam_status['online']:
        return jsonify({
            "status": "error", 
            "message": "📡 Steam appears to be offline. Please ensure Steam is online.",
            "steam_status": steam_status
        }), 400
    
    # Get the preset data from JSON file
    json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
    if not os.path.exists(json_path):
        return jsonify({"status": "error", "message": "❌ Preset not found"}), 404
        
    try:
        # Read the games from the preset
        with open(json_path, 'r') as f:
            games = json.load(f)
        
        # Keep track of started games and failed games
        started_games = []
        failed_games = []
        
        # First attempt to start all games
        for game in games:
            game_id = str(game['id'])
            if game_id not in running_games:  # Only start if not already running
                try:
                    process = subprocess.Popen([IDLER_PATH, game_id], shell=True)
                    running_games[game_id] = process.pid
                    started_games.append(game_id)
                    
                    # Initialize or update game session
                    if game_id not in game_sessions:
                        game_sessions[game_id] = {
                            'total_time': 0,
                            'name': game['name'],
                            'image': game['image']
                        }
                    game_sessions[game_id]['start_time'] = datetime.now()
                except Exception as e:
                    print(f"Failed to start game {game_id}: {e}")
                    failed_games.append(game)
        
        # Wait a moment for processes to initialize
        time.sleep(2)
        
        # Verify all games are running and retry failed ones
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            # Check which games failed to start
            failed_games = []
            for game in games:
                game_id = str(game['id'])
                if game_id in running_games:
                    try:
                        # Verify process is actually running
                        process = psutil.Process(running_games[game_id])
                        if not process.is_running():
                            failed_games.append(game)
                            del running_games[game_id]
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        failed_games.append(game)
                        del running_games[game_id]
                else:
                    failed_games.append(game)
            
            # If all games are running, break the retry loop
            if not failed_games:
                break
                
            # Retry failed games
            retry_count += 1
            if retry_count < max_retries:
                print(f"Retrying {len(failed_games)} failed games (attempt {retry_count + 1})")
                for game in failed_games:
                    game_id = str(game['id'])
                    try:
                        process = subprocess.Popen([IDLER_PATH, game_id], shell=True)
                        running_games[game_id] = process.pid
                        started_games.append(game_id)
                        
                        # Initialize or update game session
                        if game_id not in game_sessions:
                            game_sessions[game_id] = {
                                'total_time': 0,
                                'name': game['name'],
                                'image': game['image']
                            }
                        game_sessions[game_id]['start_time'] = datetime.now()
                    except Exception as e:
                        print(f"Failed to start game {game_id} on retry: {e}")
                
                # Wait between retries
                time.sleep(2)
        
        save_statistics()
        
        # Notify the UI to update through the window's evaluate_js method
        if window:
            window.evaluate_js("""
                runningGames.clear();
                %s.forEach(gameId => runningGames.add(gameId));
                updateGamesList();
                loadPresets(true).then(presets => {
                    updatePresetsList(presets);
                    updateRunningGamesList();
                });
            """ % json.dumps([str(game['id']) for game in games]))
        
        # Prepare status message
        if failed_games:
            message = f"Started {len(started_games)} games, but {len(failed_games)} failed to start"
            icon.notify(f"⚠️ {message}", "Preset Started with Issues")
            save_recent_action(f"⚠️ Started preset {preset_name} with issues")
        else:
            message = f"Started {len(started_games)} games from preset {preset_name}"
            icon.notify(f"▶️ {message}", "Preset Started")
            save_recent_action(f"▶️ Started preset {preset_name}")
        
        update_tray_menu()
        
        return jsonify({
            "status": "success" if not failed_games else "partial",
            "message": message,
            "gameIds": started_games,
            "failedGames": [{"id": g["id"], "name": g["name"]} for g in failed_games]
        })
    except Exception as e:
        icon.notify(f"❌ Error running preset: {str(e)}", "Error")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/api/stats/total-playtime')
def get_total_playtime():
    total_seconds = 0
    current_time = datetime.now()
    
    for game_id, session in game_sessions.items():
        # Add completed session time
        total_seconds += session.get('total_time', 0)
        
        # Add current session time if game is running
        if game_id in running_games and 'start_time' in session:
            current_session = (current_time - session['start_time']).total_seconds()
            total_seconds += current_session
    
    # Get tracking start date from stats file creation time
    tracking_since = datetime.fromtimestamp(os.path.getctime(STATS_FILE))
    days_tracked = max(1, (current_time - tracking_since).days)
    
    return jsonify({
        "total_time": format_duration(total_seconds),
        "total_seconds": total_seconds,
        "days_tracked": days_tracked,
        "tracking_since": tracking_since.isoformat()
    })

@app.route('/api/stats/most-idled')
def get_most_idled():
    games_list = []
    current_time = datetime.now()
    
    for game_id, session in game_sessions.items():
        total_seconds = session.get('total_time', 0)
        
        # Add current session time if game is running
        if game_id in running_games and 'start_time' in session:
            current_session = (current_time - session['start_time']).total_seconds()
            total_seconds += current_session
        
        # Use session data directly
        games_list.append({
            "id": game_id,
            "name": session.get('name', f'Game {game_id}'),
            "image": session.get('image', ''),
            "total_time": format_duration(total_seconds),
            "total_seconds": total_seconds
        })
    
    # Sort by total seconds in descending order
    games_list.sort(key=lambda x: x['total_seconds'], reverse=True)
    
    return jsonify(games_list[:5])  # Return top 5 games

@app.route('/api/stats/playtime-history/<period>')
def get_playtime_history(period):
    current_time = datetime.now()
    history = []
    
    if period == 'daily':
        # Last 24 hours in hourly intervals
        for i in range(24):
            hour_start = current_time - timedelta(hours=i+1)
            hour_end = current_time - timedelta(hours=i)
            total_seconds = 0
            
            for session in game_sessions.values():
                if 'start_time' in session and session['start_time'] >= hour_start and session['start_time'] < hour_end:
                    session_end = min(hour_end, datetime.now())
                    session_duration = (session_end - session['start_time']).total_seconds()
                    total_seconds += session_duration
            
            history.append({
                "label": hour_start.strftime("%H:00"),
                "value": total_seconds / 3600  # Convert to hours
            })
    
    elif period == 'weekly':
        # Last 7 days
        for i in range(7):
            day_start = (current_time - timedelta(days=i+1)).replace(hour=0, minute=0, second=0)
            day_end = (current_time - timedelta(days=i)).replace(hour=0, minute=0, second=0)
            total_seconds = 0
            
            for session in game_sessions.values():
                if 'start_time' in session and session['start_time'] >= day_start and session['start_time'] < day_end:
                    session_end = min(day_end, datetime.now())
                    session_duration = (session_end - session['start_time']).total_seconds()
                    total_seconds += session_duration
            
            history.append({
                "label": day_start.strftime("%a"),
                "value": total_seconds / 3600
            })
    
    elif period == 'monthly':
        # Last 30 days in weekly intervals
        for i in range(4):
            week_start = current_time - timedelta(days=(i+1)*7)
            week_end = current_time - timedelta(days=i*7)
            total_seconds = 0
            
            for session in game_sessions.values():
                if 'start_time' in session and session['start_time'] >= week_start and session['start_time'] < week_end:
                    session_end = min(week_end, datetime.now())
                    session_duration = (session_end - session['start_time']).total_seconds()
                    total_seconds += session_duration
            
            history.append({
                "label": f"Week {4-i}",
                "value": total_seconds / 3600
            })
    
    history.reverse()
    return jsonify(history)

@app.route('/api/stats/goals', methods=['GET', 'POST', 'PUT', 'DELETE'])
def manage_goals():
    goals_file = os.path.join(PRESETS_DIR, 'goals.json')
    
    if request.method == 'GET':
        if os.path.exists(goals_file):
            with open(goals_file, 'r') as f:
                return jsonify(json.load(f))
        return jsonify([])
    
    elif request.method == 'POST':
        data = request.get_json()
        if os.path.exists(goals_file):
            with open(goals_file, 'r') as f:
                goals = json.load(f)
        else:
            goals = []
        
        goals.append({
            "id": str(len(goals) + 1),
            "game_id": data['game_id'],
            "target_hours": data['target_hours'],
            "created_at": datetime.now().isoformat()
        })
        
        with open(goals_file, 'w') as f:
            json.dump(goals, f)
        
        return jsonify({"status": "success"})
    
    elif request.method == 'PUT':
        data = request.get_json()
        if os.path.exists(goals_file):
            with open(goals_file, 'r') as f:
                goals = json.load(f)
                for goal in goals:
                    if goal['id'] == data['id']:
                        goal.update(data)
                        break
            
            with open(goals_file, 'w') as f:
                json.dump(goals, f)
        
        return jsonify({"status": "success"})
    
    elif request.method == 'DELETE':
        data = request.get_json()
        if os.path.exists(goals_file):
            with open(goals_file, 'r') as f:
                goals = json.load(f)
            
            goals = [g for g in goals if g['id'] != data['id']]
            
            with open(goals_file, 'w') as f:
                json.dump(goals, f)
        
        return jsonify({"status": "success"})

def load_favorites():
    if os.path.exists(FAVORITES_FILE):
        try:
            with open(FAVORITES_FILE, 'r') as f:
                return json.load(f)
        except:
            return {"favorites": []}
    return {"favorites": []}

def save_favorites(favorites):
    with open(FAVORITES_FILE, 'w') as f:
        json.dump(favorites, f)

def load_recent_actions():
    if os.path.exists(RECENT_ACTIONS_FILE):
        try:
            with open(RECENT_ACTIONS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {"actions": []}
    return {"actions": []}

def save_recent_action(action):
    actions = load_recent_actions()
    actions["actions"].insert(0, {
        "action": action,
        "timestamp": datetime.now().isoformat()
    })
    # Keep only last 10 actions
    actions["actions"] = actions["actions"][:10]
    with open(RECENT_ACTIONS_FILE, 'w') as f:
        json.dump(actions, f)

def load_shortcuts():
    if os.path.exists(SHORTCUTS_FILE):
        try:
            with open(SHORTCUTS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {"shortcuts": []}
    return {"shortcuts": []}

def save_shortcuts(shortcuts):
    with open(SHORTCUTS_FILE, 'w') as f:
        json.dump(shortcuts, f)

@app.route('/api/favorites', methods=['GET', 'POST', 'DELETE'])
def manage_favorites():
    if request.method == 'GET':
        return jsonify(load_favorites())
    
    elif request.method == 'POST':
        data = request.get_json()
        favorites = load_favorites()
        preset_name = data.get('preset_name')
        
        if preset_name not in [f['name'] for f in favorites['favorites']]:
            # Get preset data
            presets = [p for p in os.listdir(PRESETS_DIR) if p.endswith('.json')]
            for preset in presets:
                if preset.replace('.json', '') == preset_name:
                    with open(os.path.join(PRESETS_DIR, preset), 'r') as f:
                        preset_data = json.load(f)
                        favorites['favorites'].append({
                            'name': preset_name,
                            'games': preset_data
                        })
                        save_favorites(favorites)
                        save_recent_action(f"Added {preset_name} to favorites")
                        break
        
        return jsonify({"status": "success"})
    
    elif request.method == 'DELETE':
        data = request.get_json()
        favorites = load_favorites()
        preset_name = data.get('preset_name')
        
        favorites['favorites'] = [f for f in favorites['favorites'] if f['name'] != preset_name]
        save_favorites(favorites)
        save_recent_action(f"Removed {preset_name} from favorites")
        
        return jsonify({"status": "success"})

@app.route('/api/recent-actions')
def get_recent_actions():
    return jsonify(load_recent_actions())

@app.route('/api/shortcuts', methods=['GET', 'POST', 'DELETE'])
def manage_shortcuts():
    if request.method == 'GET':
        return jsonify(load_shortcuts())
    
    elif request.method == 'POST':
        data = request.get_json()
        shortcuts = load_shortcuts()
        shortcut = {
            'id': str(len(shortcuts['shortcuts']) + 1),
            'name': data.get('name'),
            'preset_name': data.get('preset_name'),
            'key_combination': data.get('key_combination')
        }
        shortcuts['shortcuts'].append(shortcut)
        save_shortcuts(shortcuts)
        save_recent_action(f"Added shortcut for {shortcut['name']}")
        return jsonify({"status": "success"})
    
    elif request.method == 'DELETE':
        data = request.get_json()
        shortcuts = load_shortcuts()
        shortcut_id = data.get('id')
        shortcuts['shortcuts'] = [s for s in shortcuts['shortcuts'] if s['id'] != shortcut_id]
        save_shortcuts(shortcuts)
        save_recent_action(f"Removed shortcut {shortcut_id}")
        return jsonify({"status": "success"})

@app.route('/api/emergency-stop')
def emergency_stop():
    stopped_games = []
    for game_id in list(running_games.keys()):
        try:
            pid = running_games[game_id]
            process = psutil.Process(pid)
            for child in process.children(recursive=True):
                child.terminate()
            process.terminate()
            stopped_games.append(game_id)
            del running_games[game_id]
            
            # Update game session
            if game_id in game_sessions and 'start_time' in game_sessions[game_id]:
                session_duration = (datetime.now() - game_sessions[game_id]['start_time']).total_seconds()
                game_sessions[game_id]['total_time'] += session_duration
                game_sessions[game_id].pop('start_time', None)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            del running_games[game_id]
    
    save_recent_action(f"🛑 Emergency stop - Stopped {len(stopped_games)} games")
    save_statistics()
    
    return jsonify({
        "status": "success",
        "stopped_games": stopped_games
    })

@app.route('/api/startup-status', methods=['GET', 'POST'])
def startup_status():
    if request.method == 'GET':
        return jsonify({"enabled": get_startup_status()})
    
    elif request.method == 'POST':
        data = request.get_json()
        success = set_startup_status(data.get('enabled', False))
        
        if success:
            status = "enabled" if data.get('enabled') else "disabled"
            save_recent_action(f"Startup {status}")
            return jsonify({"status": "success"})
        else:
            return jsonify({
                "status": "error",
                "message": "Failed to update startup status"
            }), 500

def get_startup_status():
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_READ
        )
        try:
            winreg.QueryValueEx(key, "SteamIdleManager")
            return True
        except WindowsError:
            return False
        finally:
            winreg.CloseKey(key)
    except WindowsError:
        return False

def set_startup_status(enable):
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE
        )
        
        if enable:
            # Get the path to the executable
            if getattr(sys, 'frozen', False):
                # Running as compiled executable
                app_path = f'"{sys.executable}"'
            else:
                # Running as script
                app_path = f'pythonw "{os.path.abspath(__file__)}"'
            
            winreg.SetValueEx(
                key,
                "SteamIdleManager",
                0,
                winreg.REG_SZ,
                app_path
            )
        else:
            try:
                winreg.DeleteValue(key, "SteamIdleManager")
            except WindowsError:
                pass
        
        return True
    except Exception as e:
        print(f"Error setting startup status: {e}")
        return False
    finally:
        winreg.CloseKey(key)

def update_tray_menu():
    """Update the system tray menu with current running games and other dynamic content"""
    try:
        menu_items = []
        
        # Show Window option
        menu_items.append(pystray.MenuItem("🖥️ Show Window", show_window))
        menu_items.append(pystray.Menu.SEPARATOR)
        
        # Running Games submenu
        if running_games:
            running_items = []
            
            # Add total playtime and most idled game at the top
            total_seconds = 0
            current_time = datetime.now()
            for game_id, session in game_sessions.items():
                total_seconds += session.get('total_time', 0)
                if game_id in running_games and 'start_time' in session:
                    current_session = (current_time - session['start_time']).total_seconds()
                    total_seconds += current_session
            
            # Add total playtime header
            running_items.append(pystray.MenuItem(
                f"⏱️ Total: {format_duration(total_seconds)}", 
                lambda item: None, enabled=False))
            
            # Add total running games counter
            running_items.append(pystray.MenuItem(
                f"🎮 Idling ({len(running_games)} games)", 
                lambda item: None, enabled=False))
            
            # Add most idled game
            most_idled = get_most_idled_game()
            running_items.append(pystray.MenuItem(
                f"🏆 Most Idled: {most_idled}", 
                lambda item: None, enabled=False))
            
            running_items.append(pystray.Menu.SEPARATOR)
            
            # Add running games with their total playtime
            for game_id in running_games:
                if game_id in game_sessions and 'name' in game_sessions[game_id]:
                    game_name = game_sessions[game_id]['name']
                    total_seconds = game_sessions[game_id].get('total_time', 0)
                    
                    # Add current session time if game is running
                    if 'start_time' in game_sessions[game_id]:
                        current_session = (current_time - game_sessions[game_id]['start_time']).total_seconds()
                        total_seconds += current_session
                    
                    # Create a function that captures game_id in its scope
                    def create_stop_handler(gid):
                        return lambda item: stop_single_game_tray(icon, item, gid)
                    
                    # Format menu item with game name and total time
                    menu_text = f"⏹️ Stop {game_name} ({format_duration(total_seconds)})"
                    running_items.append(pystray.MenuItem(menu_text, 
                        create_stop_handler(game_id)))
            
            if running_items:
                menu_items.append(pystray.MenuItem("🎮 Running Games", pystray.Menu(*running_items)))
                menu_items.append(pystray.Menu.SEPARATOR)
        
        # Add favorites submenu
        favorites = load_favorites()
        if favorites.get('favorites', []):
            favorites_items = []
            for favorite in favorites['favorites']:
                # Create a function that captures preset_name in its scope
                def create_favorite_handler(preset_name):
                    return lambda item: run_preset_tray(icon, item, preset_name)
                favorites_items.append(pystray.MenuItem(f"▶️ {favorite['name']}", 
                    create_favorite_handler(favorite['name'])))
            menu_items.append(pystray.MenuItem("⭐ Favorites", pystray.Menu(*favorites_items)))
        
        # Add Presets submenu
        presets = []
        if os.path.exists(PRESETS_DIR):
            for filename in os.listdir(PRESETS_DIR):
                if filename.endswith('.json'):
                    preset_name = filename[:-5]
                    # Create a function that captures preset_name in its scope
                    def create_preset_handler(name):
                        return lambda item: run_preset_tray(icon, item, name)
                    presets.append(pystray.MenuItem(f"▶️ {preset_name}", 
                        create_preset_handler(preset_name)))
            if presets:
                menu_items.append(pystray.MenuItem("📋 Presets", pystray.Menu(*presets)))
        
        # Add remaining menu items
        menu_items.append(pystray.Menu.SEPARATOR)
        menu_items.append(pystray.MenuItem("🚀 Launch Steam", launch_steam_tray, 
                                         enabled=lambda item: not is_steam_running()))
        menu_items.append(pystray.Menu.SEPARATOR)
        menu_items.append(pystray.MenuItem("🛑 Emergency Stop", emergency_stop_tray, 
                                         enabled=lambda item: bool(running_games)))
        
        # Add Minimize/Maximize Toggle button
        if running_games:
            # Check if any game window is minimized to determine the button text
            windows = []
            def check_window_state(hwnd, windows):
                if win32gui.IsWindowVisible(hwnd):
                    try:
                        _, pid = win32process.GetWindowThreadProcessId(hwnd)
                        process = psutil.Process(pid)
                        if 'steam-idle' in process.name().lower():
                            # Store window handle and state
                            is_minimized = win32gui.IsIconic(hwnd)
                            windows.append(is_minimized)
                    except Exception:
                        pass
            
            win32gui.EnumWindows(check_window_state, windows)
            
            # If any window is not minimized, show "Maximize All", otherwise show "Minimize All"
            all_minimized = all(windows) if windows else False
            button_text = "🔼 Maximize All" if all_minimized else "🔽 Minimize All"
            menu_items.append(pystray.MenuItem(button_text, 
                lambda item: toggle_minimize_all_tray(icon, item, not all_minimized)))
        
        menu_items.append(pystray.Menu.SEPARATOR)
        menu_items.append(pystray.MenuItem("❌ Exit", exit_app))
        
        # Create the menu tuple with only non-None items
        menu = pystray.Menu(*[item for item in menu_items if item is not None])
        
        # Update the icon's menu
        icon.menu = menu

    except Exception as e:
        print(f"Error updating tray menu: {e}")
        icon.notify(f"❌ Error updating tray menu: {str(e)}", "Error")

def toggle_minimize_all_tray(icon, item, minimize=True):
    """Handle minimize/maximize all games from tray icon"""
    try:
        # Get all running game windows
        windows = []
        
        def callback(hwnd, windows):
            if win32gui.IsWindowVisible(hwnd):
                try:
                    # Get the process ID for this window
                    _, pid = win32process.GetWindowThreadProcessId(hwnd)
                    process = psutil.Process(pid)
                    
                    # Check if this is a steam-idle process
                    if 'steam-idle' in process.name().lower():
                        windows.append(hwnd)
                except Exception:
                    pass
        
        win32gui.EnumWindows(callback, windows)
        
        # Minimize or restore all game windows
        success_count = 0
        for hwnd in windows:
            try:
                if minimize:
                    win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
                else:
                    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                success_count += 1
            except Exception as e:
                print(f"Error toggling window state: {str(e)}")
                continue
        
        if success_count > 0:
            action = "minimized" if minimize else "restored"
            save_recent_action(f"All running games {action}")
            
            # Force update the tray menu to reflect the new state
            update_tray_menu()
            
            # Show notification
            message = f"{success_count} game windows have been {action}"
            icon.notify(message, "Window State Changed")
            
            return True
        else:
            icon.notify("No game windows found to toggle", "Window State")
            return False
            
    except Exception as e:
        print(f"Error toggling minimize state: {e}")
        return False

def toggle_minimize_games(minimize=True):
    """Toggle minimize/maximize state of all running game windows - API version"""
    with app.app_context():
        try:
            # Get all running game windows
            windows = []
            
            def callback(hwnd, windows):
                if win32gui.IsWindowVisible(hwnd):
                    try:
                        # Get the process ID for this window
                        _, pid = win32process.GetWindowThreadProcessId(hwnd)
                        process = psutil.Process(pid)
                        
                        # Check if this is a steam-idle process
                        if 'steam-idle' in process.name().lower():
                            windows.append(hwnd)
                    except Exception:
                        pass
            
            win32gui.EnumWindows(callback, windows)
            
            # Minimize or restore all game windows
            success_count = 0
            for hwnd in windows:
                try:
                    if minimize:
                        win32gui.ShowWindow(hwnd, win32con.SW_MINIMIZE)
                    else:
                        win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                    success_count += 1
                except Exception as e:
                    print(f"Error toggling window state: {str(e)}")
                    continue
            
            if success_count > 0:
                action = "minimized" if minimize else "restored"
                save_recent_action(f"All running games {action}")
                
                return jsonify({
                    "success": True,
                    "message": f"{success_count} game windows have been {action}"
                })
            else:
                return jsonify({
                    "success": False,
                    "message": "No game windows found to toggle"
                })
                
        except Exception as e:
            return jsonify({
                "success": False,
                "message": f"Failed to toggle game windows: {str(e)}"
            }), 500

@app.route('/api/toggle-minimize-games', methods=['POST'])
def api_toggle_minimize_games():
    """API endpoint for toggling minimize/maximize state of game windows"""
    try:
        data = request.get_json()
        minimize = data.get('minimize', True)
        return toggle_minimize_games(minimize)
    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"Failed to toggle game windows: {str(e)}"
        }), 500

def create_tray_icon():
    global icon
    try:
        # Load the icon image
        image = Image.open(resource_path("Logo.png"))
        
        # Create initial menu with basic items
        initial_menu = (
            pystray.MenuItem("🖥️ Show", show_window),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("❌ Exit", exit_app)
        )
        
        # Create the icon
        icon = pystray.Icon("SteamIdleManager", image, "Steam Idle Manager", initial_menu)
        
        # Update the menu immediately
        update_tray_menu()
        
        # Run the icon in a separate thread
        icon_thread = threading.Thread(target=icon.run)
        icon_thread.daemon = True
        icon_thread.start()
        
    except Exception as e:
        print(f"Error creating tray icon: {e}")

def on_closed():
    try:
        settings = load_settings()
        if settings.get('minimize_to_tray', False):
            # Just minimize to tray
            if icon:
                window.hide()
                icon.notify("💤 Steam Idle Manager is still running in the background", "Minimized to Tray")
            return False
        else:
            # Actually close the app
            if icon:
                icon.stop()
            sys.exit(0)
    except Exception as e:
        print(f"Error in on_closed: {e}")
        sys.exit(0)

def handle_minimize_event():
    settings = load_settings()
    if settings.get('minimize_to_tray', False):
        window.hide()
        # Show notification in system tray
        if icon:
            icon.notify("💤 Steam Idle Manager is still running in the background", "Minimized to Tray")
        return True  # Prevent default minimize
    return True  # Allow default minimize if setting is disabled

def check_and_restart_games():
    """Check if any running games have crashed and restart them if auto-reconnect is enabled"""
    while True:
        if AUTO_RECONNECT:
            for game_id in list(running_games.keys()):
                try:
                    process = psutil.Process(running_games[game_id])
                    if not process.is_running():
                        print(f"Game {game_id} crashed, restarting...")
                        restart_game(game_id)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    print(f"Game {game_id} crashed, restarting...")
                    restart_game(game_id)
        time.sleep(RECONNECT_INTERVAL)

def restart_game(game_id):
    """Restart a crashed game"""
    try:
        process = subprocess.Popen([IDLER_PATH, game_id], shell=True)
        running_games[game_id] = process.pid
        if icon:
            icon.notify(f"🔄 Game {game_id} was restarted automatically", "Auto-Reconnect")
    except Exception as e:
        print(f"Error restarting game {game_id}: {e}")

def check_game_goals():
    """Check if any game has reached its playtime goal"""
    while True:
        goals = load_goals()
        for goal in goals:
            game_id = goal['game_id']
            target_hours = goal['target_hours']
            
            if game_id in game_sessions:
                session = game_sessions[game_id]
                total_seconds = session.get('total_time', 0)
                
                # Add current session time if game is running
                if game_id in running_games and 'start_time' in session:
                    current_session = (datetime.now() - session['start_time']).total_seconds()
                    total_seconds += current_session
                
                total_hours = total_seconds / 3600
                if total_hours >= target_hours and not goal.get('notified', False):
                    if icon:
                        icon.notify(
                            f"🏆 Game {session.get('name', game_id)} has reached the target playtime of {target_hours} hours!",
                            "Goal Reached"
                        )
                    goal['notified'] = True
                    save_goals(goals)
        
        time.sleep(60)  # Check every minute

def load_goals():
    goals_file = os.path.join(PRESETS_DIR, 'goals.json')
    if os.path.exists(goals_file):
        try:
            with open(goals_file, 'r') as f:
                return json.load(f)
        except:
            return []
    return []

def save_goals(goals):
    goals_file = os.path.join(PRESETS_DIR, 'goals.json')
    with open(goals_file, 'w') as f:
        json.dump(goals, f)

@app.route('/api/export-stats', methods=['POST'])
def export_stats():
    try:
        data = request.get_json()
        export_type = data.get('format', 'csv')
        preferences = data.get('preferences', {})
        
        # Define field mappings
        field_mappings = {
            'game_id': 'Game ID',
            'game_name': 'Game Name',
            'store_url': 'Steam Store URL',
            'time_hhmmss': 'Total Time (HH:MM:SS)',
            'hours': 'Total Hours',
            'percentage': 'Percentage of Total Time',
            'rank': 'Most Idled Rank',
            'status': 'Status',
            'session': 'Current Session',
            'favorite': 'Is Favorite'
        }
        
        # Get selected fields based on preferences
        selected_fields = [field_mappings[key] for key, value in preferences.items() if value]
        
        # If no fields selected, use default fields
        if not selected_fields:
            selected_fields = ['Game ID', 'Game Name', 'Total Time (HH:MM:SS)', 'Total Hours', 'Most Idled Rank']
        
        # Prepare statistics data
        stats = []
        current_time = datetime.now()
        total_seconds = 0
        
        # First, get the most idled games to determine rankings
        most_idled = []
        for game_id, session in game_sessions.items():
            game_total_seconds = session.get('total_time', 0)
            
            # Add current session time if game is running
            if game_id in running_games and 'start_time' in session:
                current_session = (current_time - session['start_time']).total_seconds()
                game_total_seconds += current_session
            
            total_seconds += game_total_seconds
            most_idled.append({
                'game_id': game_id,
                'total_seconds': game_total_seconds
            })
        
        # Sort by total time to determine rankings
        most_idled.sort(key=lambda x: x['total_seconds'], reverse=True)
        rank_map = {game['game_id']: f"#{idx + 1}" for idx, game in enumerate(most_idled[:5])}
        
        # Prepare the full stats with selected fields
        for game_id, session in game_sessions.items():
            game_total_seconds = session.get('total_time', 0)
            current_session_time = 0
            is_running = game_id in running_games
            
            if is_running and 'start_time' in session:
                current_session_time = (current_time - session['start_time']).total_seconds()
                game_total_seconds += current_session_time
            
            percentage = (game_total_seconds / total_seconds * 100) if total_seconds > 0 else 0
            
            # Create full game data
            game_data = {
                'Game ID': game_id,
                'Game Name': session.get('name', 'Unknown Game'),
                'Steam Store URL': f"https://store.steampowered.com/app/{game_id}",
                'Total Time (HH:MM:SS)': format_duration(game_total_seconds),
                'Total Hours': round(game_total_seconds / 3600, 2),
                'Percentage of Total Time': f"{percentage:.2f}%",
                'Most Idled Rank': rank_map.get(game_id, '-'),
                'Status': 'Running' if is_running else 'Stopped',
                'Current Session': format_duration(current_session_time) if is_running else '-',
                'Is Favorite': 'Yes' if game_id in load_game_favorites() else 'No'
            }
            
            # Filter data based on selected fields
            filtered_data = {field: game_data[field] for field in selected_fields}
            stats.append(filtered_data)
        
        # Sort stats by total hours in descending order
        if 'Total Hours' in selected_fields:
            stats.sort(key=lambda x: x.get('Total Hours', 0), reverse=True)
        
        # Prepare summary statistics
        summary = {
            'Total Games': len(stats),
            'Total Playtime (Hours)': round(total_seconds / 3600, 2),
            'Total Playtime (HH:MM:SS)': format_duration(total_seconds),
            'Average Daily Playtime (Hours)': round((total_seconds / 3600) / max(1, (current_time - datetime.fromtimestamp(os.path.getctime(STATS_FILE))).days), 2),
            'Export Date': current_time.strftime('%Y-%m-%d %H:%M:%S'),
            'Currently Running Games': len(running_games)
        }
        
        if export_type == 'csv':
            filename = f"steam_idle_stats_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            filepath = os.path.join(APPDATA_PATH, filename)
            
            with open(filepath, 'w', newline='', encoding='utf-8') as f:
                # Write summary section
                f.write("# Summary Statistics\n")
                for key, value in summary.items():
                    f.write(f"{key},{value}\n")
                f.write("\n# Game Statistics\n")
                
                # Write game statistics with selected fields
                writer = csv.DictWriter(f, fieldnames=selected_fields)
                writer.writeheader()
                writer.writerows(stats)
            
            try:
                return send_file(
                    filepath,
                    as_attachment=True,
                    download_name=filename,
                    mimetype='text/csv'
                )
            finally:
                try:
                    os.remove(filepath)
                except:
                    pass
                    
        elif export_type == 'json':
            # Create JSON structure with selected fields
            json_data = {
                'summary': summary,
                'games': stats
            }
            
            filename = f"steam_idle_stats_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            filepath = os.path.join(APPDATA_PATH, filename)
            
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(json_data, f, indent=2)
            
            try:
                return send_file(
                    filepath,
                    as_attachment=True,
                    download_name=filename,
                    mimetype='application/json'
                )
            finally:
                try:
                    os.remove(filepath)
                except:
                    pass
        
        else:
            return jsonify({
                "status": "error",
                "message": "Invalid export type"
            }), 400
            
    except Exception as e:
        print(f"Export error: {str(e)}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/api/auto-reconnect', methods=['POST'])
def toggle_auto_reconnect():
    global AUTO_RECONNECT
    data = request.get_json()
    AUTO_RECONNECT = data.get('enabled', False)
    save_recent_action(f"{'Enabled' if AUTO_RECONNECT else 'Disabled'} auto-reconnect")
    return jsonify({"status": "success"})

@app.route('/api/stats/reset', methods=['POST'])
def reset_statistics():
    global game_sessions
    try:
        # Clear game sessions
        game_sessions = {}
        
        # Delete stats file
        if os.path.exists(STATS_FILE):
            os.remove(STATS_FILE)
            
        # Save empty statistics
        save_statistics()
        
        # Log the action
        save_recent_action("Reset all statistics")
        
        return jsonify({"status": "success", "message": "Statistics reset successfully"})
    except Exception as e:
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/api/rename-preset', methods=['POST'])
def rename_preset():
    data = request.get_json()
    old_name = data.get('oldName')
    new_name = data.get('newName')
    
    if not old_name or not new_name:
        return jsonify({"status": "error", "message": "Missing preset names"}), 400
    
    try:
        # Rename JSON file
        old_json_path = os.path.join(PRESETS_DIR, f"{old_name}.json")
        new_json_path = os.path.join(PRESETS_DIR, f"{new_name}.json")
        
        # Rename BAT file
        old_bat_path = os.path.join(PRESETS_DIR, f"{old_name}.bat")
        new_bat_path = os.path.join(PRESETS_DIR, f"{new_name}.bat")
        
        if os.path.exists(new_json_path) or os.path.exists(new_bat_path):
            return jsonify({"status": "error", "message": "A preset with this name already exists"}), 400
        
        if os.path.exists(old_json_path):
            os.rename(old_json_path, new_json_path)
        if os.path.exists(old_bat_path):
            os.rename(old_bat_path, new_bat_path)
            
        # Add to recent actions
        save_recent_action(f"Renamed preset from '{old_name}' to '{new_name}'")
        
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/settings', methods=['GET', 'POST'])
def manage_settings():
    global minimize_to_tray, AUTO_RECONNECT, DISCORD_RPC_ENABLED
    if request.method == 'POST':
        data = request.get_json()
        settings = load_settings()
        
        # Handle all settings
        if 'theme' in data:
            settings['theme'] = data['theme']
        
        if 'minimize_to_tray' in data:
            settings['minimize_to_tray'] = data['minimize_to_tray']
            minimize_to_tray = data['minimize_to_tray']
        
        if 'auto_reconnect' in data:
            settings['auto_reconnect'] = data['auto_reconnect']
            AUTO_RECONNECT = data['auto_reconnect']
        
        if 'discord_rpc_enabled' in data:
            settings['discord_rpc_enabled'] = data['discord_rpc_enabled']
            DISCORD_RPC_ENABLED = data['discord_rpc_enabled']
            if DISCORD_RPC_ENABLED:
                initialize_discord_rpc()
            elif DISCORD_RPC:
                try:
                    DISCORD_RPC.close()
                except:
                    pass
        
        if 'run_on_startup' in data:
            settings['run_on_startup'] = data['run_on_startup']
            set_startup_status(data['run_on_startup'])
        
        if save_settings(settings):
            save_recent_action("Updated settings")
            return jsonify({"status": "success", "message": "Settings updated successfully"})
        else:
            return jsonify({"status": "error", "message": "Failed to save settings"}), 500
    else:
        # GET request - return current settings
        settings = load_settings()
        # Add startup status
        settings['run_on_startup'] = get_startup_status()
        return jsonify(settings)

@app.route('/api/reconfigure-idle', methods=['POST'])
def reconfigure_idle():
    """Endpoint to reconfigure steam-idle.exe location"""
    global IDLER_PATH
    
    try:
        new_path = select_idle_executable()
        if new_path and os.path.exists(new_path):
            IDLER_PATH = new_path
            settings = load_settings()
            settings['idler_path'] = new_path
            settings['setup_completed'] = True
            
            if save_settings(settings):
                save_recent_action("Updated steam-idle.exe location")
                return jsonify({
                    "status": "success",
                    "message": "Steam Idle location updated successfully",
                    "path": new_path
                })
            else:
                return jsonify({
                    "status": "error",
                    "message": "Failed to save settings"
                }), 500
        
        return jsonify({
            "status": "error",
            "message": "No valid file selected or file does not exist"
        }), 400
        
    except Exception as e:
        print(f"Error in reconfigure_idle: {e}")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

@app.route('/api/get-idle-path')
def get_idle_path():
    """Get the current steam-idle.exe path"""
    settings = load_settings()
    return jsonify({
        "path": settings.get('idler_path', IDLER_PATH)
    })

@app.route('/api/stop-preset', methods=['POST'])
def stop_preset(preset_name=None):
    """Stop all games in a preset"""
    try:
        if preset_name is None:
            data = request.get_json()
            preset_name = data.get('name')
            
        if not preset_name:
            return jsonify({"status": "error", "message": "No preset name provided"}), 400
            
        json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
        if not os.path.exists(json_path):
            return jsonify({"status": "error", "message": "Preset not found"}), 404
            
        # Read the games from the preset
        with open(json_path, 'r') as f:
            games = json.load(f)
            
        stopped_games = []
        for game in games:
            game_id = str(game['id'])
            if game_id in running_games:
                try:
                    pid = running_games[game_id]
                    process = psutil.Process(pid)
                    for child in process.children(recursive=True):
                        child.terminate()
                    process.terminate()
                    stopped_games.append(game_id)
                    
                    # Update game session
                    if game_id in game_sessions and 'start_time' in game_sessions[game_id]:
                        session_duration = (datetime.now() - game_sessions[game_id]['start_time']).total_seconds()
                        game_sessions[game_id]['total_time'] += session_duration
                        game_sessions[game_id].pop('start_time', None)
                    
                    del running_games[game_id]
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    del running_games[game_id]
                    
        # Save statistics
        save_statistics()
        save_recent_action(f"Stopped preset {preset_name}")
        
        # Update tray menu
        update_tray_menu()
        
        return jsonify({
            "status": "success",
            "stopped_games": stopped_games
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def update_tray_periodically():
    """Update the system tray menu every 30 seconds to refresh playtimes and status"""
    while True:
        try:
            update_tray_menu()
        except Exception as e:
            print(f"Error in periodic tray update: {e}")
        time.sleep(30)

def show_window(icon, item):
    window.show()
    window.restore()  # Restore from minimized state

def exit_app(icon, item):
    icon.stop()
    window.destroy()
    sys.exit(0)

def emergency_stop_tray(icon, item):
    # Stop all running games
    stopped_games = []
    for game_id in list(running_games.keys()):
        try:
            pid = running_games[game_id]
            process = psutil.Process(pid)
            for child in process.children(recursive=True):
                child.terminate()
            process.terminate()
            stopped_games.append(game_id)
            del running_games[game_id]
            
            # Update game session
            if game_id in game_sessions and 'start_time' in game_sessions[game_id]:
                session_duration = (datetime.now() - game_sessions[game_id]['start_time']).total_seconds()
                game_sessions[game_id]['total_time'] += session_duration
                game_sessions[game_id].pop('start_time', None)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            del running_games[game_id]
    
    save_recent_action(f"🛑 Emergency stop from tray - Stopped {len(stopped_games)} games")
    save_statistics()
    if icon:
        icon.notify(f"🛑 Stopped {len(stopped_games)} games", "Emergency Stop")
    update_tray_menu()

def stop_single_game_tray(icon, item, game_id):
    """Stop a single game from the system tray menu"""
    try:
        if game_id in running_games:
            pid = running_games[game_id]
            process = psutil.Process(pid)
            for child in process.children(recursive=True):
                child.terminate()
            process.terminate()
            
            # Update game session
            if game_id in game_sessions and 'start_time' in game_sessions[game_id]:
                session_duration = (datetime.now() - game_sessions[game_id]['start_time']).total_seconds()
                game_sessions[game_id]['total_time'] += session_duration
                game_sessions[game_id].pop('start_time', None)
            
            del running_games[game_id]
            save_statistics()
            
            # Notify the UI to update through the window's evaluate_js method
            if window:
                window.evaluate_js("""
                    runningGames.delete('%s');
                    updateGamesList();
                    loadPresets(true).then(presets => {
                        updatePresetsList(presets);
                        updateRunningGamesList();
                    });
                """ % game_id)
            
            icon.notify(f"⏹️ Stopped {game_sessions[game_id]['name']}", "Game Stopped")
            save_recent_action(f"⏹️ Stopped game {game_sessions[game_id]['name']} from tray")
            update_tray_menu()
    except Exception as e:
        icon.notify(f"❌ Error stopping game: {str(e)}", "Error")

def run_preset_tray(icon, item, preset_name):
    """Run a preset from the system tray menu"""
    # Check Steam status first
    steam_status = check_steam_status()
    if not steam_status['running']:
        icon.notify("🚫 Steam is not running. Please start Steam first.", "Error")
        return
    
    if not steam_status['online']:
        icon.notify("📡 Steam appears to be offline. Please ensure Steam is online.", "Error")
        return
    
    try:
        # Get the preset data from JSON file
        json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
        if not os.path.exists(json_path):
            icon.notify(f"❌ Preset {preset_name} not found", "Error")
            return
            
        with open(json_path, 'r') as f:
            games = json.load(f)
        
        # Keep track of started games and failed games
        started_games = []
        failed_games = []
        
        # First attempt to start all games
        for game in games:
            game_id = str(game['id'])
            if game_id not in running_games:  # Only start if not already running
                try:
                    process = subprocess.Popen([IDLER_PATH, game_id], shell=True)
                    running_games[game_id] = process.pid
                    started_games.append(game_id)
                    
                    # Initialize or update game session
                    if game_id not in game_sessions:
                        game_sessions[game_id] = {
                            'total_time': 0,
                            'name': game['name'],
                            'image': game['image']
                        }
                    game_sessions[game_id]['start_time'] = datetime.now()
                except Exception as e:
                    print(f"Failed to start game {game_id}: {e}")
                    failed_games.append(game)
        
        # Wait a moment for processes to initialize
        time.sleep(2)
        
        # Verify all games are running and retry failed ones
        max_retries = 3
        retry_count = 0
        
        while retry_count < max_retries:
            # Check which games failed to start
            failed_games = []
            for game in games:
                game_id = str(game['id'])
                if game_id in running_games:
                    try:
                        # Verify process is actually running
                        process = psutil.Process(running_games[game_id])
                        if not process.is_running():
                            failed_games.append(game)
                            del running_games[game_id]
                    except (psutil.NoSuchProcess, psutil.AccessDenied):
                        failed_games.append(game)
                        del running_games[game_id]
                else:
                    failed_games.append(game)
            
            # If all games are running, break the retry loop
            if not failed_games:
                break
                
            # Retry failed games
            retry_count += 1
            if retry_count < max_retries:
                print(f"Retrying {len(failed_games)} failed games (attempt {retry_count + 1})")
                for game in failed_games:
                    game_id = str(game['id'])
                    try:
                        process = subprocess.Popen([IDLER_PATH, game_id], shell=True)
                        running_games[game_id] = process.pid
                        started_games.append(game_id)
                        
                        # Initialize or update game session
                        if game_id not in game_sessions:
                            game_sessions[game_id] = {
                                'total_time': 0,
                                'name': game['name'],
                                'image': game['image']
                            }
                        game_sessions[game_id]['start_time'] = datetime.now()
                    except Exception as e:
                        print(f"Failed to start game {game_id} on retry: {e}")
                
                # Wait between retries
                time.sleep(2)
        
        save_statistics()
        
        # Notify the UI to update through the window's evaluate_js method
        if window:
            window.evaluate_js("""
                runningGames.clear();
                %s.forEach(gameId => runningGames.add(gameId));
                updateGamesList();
                loadPresets(true).then(presets => {
                    updatePresetsList(presets);
                    updateRunningGamesList();
                });
            """ % json.dumps([str(game['id']) for game in games]))
        
        # Prepare status message
        if failed_games:
            message = f"Started {len(started_games)} games, but {len(failed_games)} failed to start"
            icon.notify(f"⚠️ {message}", "Preset Started with Issues")
            save_recent_action(f"⚠️ Started preset {preset_name} with issues")
        else:
            message = f"Started {len(started_games)} games from preset {preset_name}"
            icon.notify(f"▶️ {message}", "Preset Started")
            save_recent_action(f"▶️ Started preset {preset_name}")
        
        update_tray_menu()
        
        return jsonify({
            "status": "success" if not failed_games else "partial",
            "message": message,
            "gameIds": started_games,
            "failedGames": [{"id": g["id"], "name": g["name"]} for g in failed_games]
        })
    except Exception as e:
        icon.notify(f"❌ Error running preset: {str(e)}", "Error")
        return jsonify({
            "status": "error",
            "message": str(e)
        }), 500

def launch_steam_tray(icon, item):
    steam_path = get_steam_path()
    if steam_path:
        try:
            steam_exe = os.path.join(steam_path, "Steam.exe")
            if os.path.exists(steam_exe):
                subprocess.Popen([steam_exe])
                icon.notify("🚀 Steam launch initiated", "Steam")
                save_recent_action("🚀 Launched Steam from tray")
            else:
                icon.notify("❌ Steam executable not found", "Error")
        except Exception as e:
            icon.notify(f"❌ Error launching Steam: {str(e)}", "Error")
    else:
        icon.notify("❌ Steam installation not found", "Error")

def get_game_playtime(game_id):
    if game_id in game_sessions:
        session = game_sessions[game_id]
        total_seconds = session.get('total_time', 0)
        
        # Add current session time if game is running
        if game_id in running_games and 'start_time' in session:
            current_session = (datetime.now() - session['start_time']).total_seconds()
            total_seconds += current_session
        
        return format_duration(total_seconds)
    return "00:00:00"

def get_most_idled_game():
    most_idled = None
    max_time = 0
    
    for game_id, session in game_sessions.items():
        total_seconds = session.get('total_time', 0)
        if game_id in running_games and 'start_time' in session:
            current_session = (datetime.now() - session['start_time']).total_seconds()
            total_seconds += current_session
        
        if total_seconds > max_time:
            max_time = total_seconds
            most_idled = session
    
    if most_idled:
        return f"{most_idled['name']} ({format_duration(max_time)})"
    return "None"

def get_steam_id():
    """Get user's Steam ID from registry or config"""
    try:
        # Try to get Steam ID from registry
        hkey = winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Software\\Valve\\Steam\\ActiveProcess")
        steam_id = winreg.QueryValueEx(hkey, "ActiveUser")[0]
        winreg.CloseKey(hkey)
        return str(steam_id) if steam_id != 0 else None
    except:
        return None

def get_steam_library():
    """Get list of games from user's Steam library"""
    try:
        steam_id = get_steam_id()
        if not steam_id:
            return {"error": "🚫 Steam ID not found. Please make sure you're logged into Steam."}

        # Get installed games from Steam installation
        steam_path = get_steam_path()
        if not steam_path:
            return {"error": "❌ Steam installation not found"}

        # Get all games from Steam Web API
        all_games = {}
        try:
            # First try to get games from Steam Community profile
            profile_url = f"https://steamcommunity.com/profiles/{steam_id}/games?tab=all"
            response = requests.get(profile_url)
            if response.ok:
                # Extract games list from JavaScript variable in the page
                games_match = re.search(r'var rgGames = (\[.*?\]);', response.text)
                if games_match:
                    games_data = json.loads(games_match.group(1))
                    for game in games_data:
                        game_id = str(game.get('appid'))
                        all_games[game_id] = {
                            "id": game_id,
                            "name": game.get('name', 'Unknown Game'),
                            "icon": game.get('logo', ''),
                            "installed": False,
                            "hours": game.get('hours_forever', '0'),
                            "last_played": game.get('last_played', 0)
                        }
        except Exception as e:
            print(f"Error fetching games from Steam Community: {e}")

        # Get installed games from local machine
        libraryfolders_path = os.path.join(steam_path, "steamapps", "libraryfolders.vdf")
        if os.path.exists(libraryfolders_path):
            library_folders = []
            with open(libraryfolders_path, 'r', encoding='utf-8') as f:
                content = f.read()
                for line in content.split('\n'):
                    if '"path"' in line:
                        path = line.split('"')[3].replace('\\\\', '\\')
                        library_folders.append(path)

            # Mark installed games
            for library in library_folders:
                apps_path = os.path.join(library, "steamapps")
                if os.path.exists(apps_path):
                    for file in os.listdir(apps_path):
                        if file.startswith("appmanifest_") and file.endswith(".acf"):
                            with open(os.path.join(apps_path, file), 'r', encoding='utf-8') as f:
                                manifest = f.read()
                                game_id = file.replace("appmanifest_", "").replace(".acf", "")
                                name_match = re.search(r'"name"\s*"([^"]+)"', manifest)
                                game_name = name_match.group(1) if name_match else "Unknown Game"
                                
                                if game_id in all_games:
                                    all_games[game_id]['installed'] = True
                                else:
                                    # Get game icon from Steam API
                                    icon_url = f"https://steamcdn-a.akamaihd.net/steam/apps/{game_id}/header.jpg"
                                    all_games[game_id] = {
                                        "id": game_id,
                                        "name": game_name,
                                        "icon": icon_url,
                                        "installed": True,
                                        "hours": "0",
                                        "last_played": 0
                                    }

        return {"games": list(all_games.values())}
    except Exception as e:
        return {"error": str(e)}

@app.route('/api/steam-library')
def steam_library():
    """API endpoint to get user's Steam library"""
    return jsonify(get_steam_library())

@app.route('/api/import-from-library', methods=['POST'])
def import_from_library():
    """Import selected games from Steam library to create a preset"""
    try:
        data = request.get_json()
        game_ids = data.get('gameIds', [])
        preset_name = data.get('presetName')

        if not game_ids or not preset_name:
            return jsonify({"error": "🚫 Missing game IDs or preset name"}), 400

        # Get game info for each selected game
        games = []
        for game_id in game_ids:
            game_info = fetch_game_info(str(game_id))
            if 'error' not in game_info:
                games.append(game_info)

        # Save as preset
        preset_json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
        with open(preset_json_path, 'w') as f:
            json.dump(games, f)

        # Create BAT file
        bat_content = "@echo off\n"
        bat_content += f'cd "{os.path.dirname(IDLER_PATH)}"\n'
        for game in games:
            bat_content += f'start steam-idle.exe {game["id"]}\n'

        bat_path = os.path.join(PRESETS_DIR, f"{preset_name}.bat")
        with open(bat_path, 'w') as f:
            f.write(bat_content)

        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/suspend-game', methods=['POST'])
def suspend_game():
    data = request.get_json()
    game_id = str(data.get('gameId'))
    
    if game_id not in running_games:
        return jsonify({"status": "error", "message": "🚫 Game is not running"}), 400
    
    try:
        # Get the process
        pid = running_games[game_id]
        process = psutil.Process(pid)
        
        # Suspend the process
        process.suspend()
        
        return jsonify({"status": "success"})
    except psutil.NoSuchProcess:
        # If process doesn't exist, remove it from running games
        running_games.pop(game_id, None)
        return jsonify({"status": "error", "message": "❌ Game process not found"}), 404
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Add resume game route for future use
@app.route('/api/resume-game', methods=['POST'])
def resume_game():
    data = request.get_json()
    game_id = str(data.get('gameId'))
    
    if game_id not in running_games:
        return jsonify({"status": "error", "message": "🚫 Game is not running"}), 400
    
    try:
        # Get the process
        pid = running_games[game_id]
        process = psutil.Process(pid)
        
        # Resume the process
        process.resume()
        
        return jsonify({"status": "success"})
    except psutil.NoSuchProcess:
        # If process doesn't exist, remove it from running games
        running_games.pop(game_id, None)
        return jsonify({"status": "error", "message": "❌ Game process not found"}), 404
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

def check_internet_connection():
    try:
        # Try to connect to a reliable host
        socket.create_connection(("8.8.8.8", 53), timeout=3)
        return True
    except OSError:
        return False

def show_no_internet_error():
    import tkinter as tk
    from tkinter import ttk
    
    def retry_connection():
        if check_internet_connection():
            # Show success message before closing
            message_label.config(text="📶 Connection detected!\nStarting the program...", fg='#00FF00')
            dialog.after(1500, dialog.destroy)  # Close after 1.5 seconds
            return True
        else:
            # Show the notification label with animation
            notification_label.config(text="🚫 There's no connection")
            notification_label.pack(pady=(0, 10))
            dialog.after(100, lambda: notification_label.config(fg='#FF4444'))  # Fade in red color
            dialog.after(2000, lambda: notification_label.pack_forget())  # Hide after 2 seconds
            return False
    
    def close_app():
        dialog.destroy()
        sys.exit(1)
    
    # Create the custom dialog
    dialog = tk.Tk()
    dialog.title("Connection Error")
    dialog.configure(bg='#1E1E1E')
    dialog.overrideredirect(True)  # Remove window decorations
    
    # Set dialog size
    dialog_width = 350
    dialog_height = 249
    dialog.geometry(f"{dialog_width}x{dialog_height}")
    
    # Main frame
    main_frame = tk.Frame(dialog, bg='#1E1E1E')
    main_frame.pack(fill='both', expand=True)
    
    # Title bar
    title_frame = tk.Frame(main_frame, bg='#1E1E1E')
    title_frame.pack(fill='x', padx=10, pady=5)
    
    title_label = tk.Label(title_frame, text="Connection Error", fg='#CCCCCC', bg='#1E1E1E', font=('Segoe UI', 11))
    title_label.pack(side='left')
    
    close_btn = tk.Label(title_frame, text="×", fg='#CCCCCC', bg='#1E1E1E', font=('Segoe UI', 11))
    close_btn.pack(side='right')
    close_btn.bind('<Button-1>', lambda e: close_app())
    
    # Warning icon (triangle with exclamation mark)
    icon_text = "⚠"
    icon_label = tk.Label(main_frame, text=icon_text, fg='#FFA500', bg='#1E1E1E', font=('Segoe UI', 36))
    icon_label.pack(pady=(10, 5))
    
    # Error message
    message_label = tk.Label(main_frame, 
                           text="📵 No internet connection detected!\n\nPlease check your connection and try again.",
                           fg='#CCCCCC',
                           bg='#1E1E1E',
                           font=('Segoe UI', 9),
                           justify='center')
    message_label.pack(pady=(0, 10))
    
    # Notification label (hidden by default)
    notification_label = tk.Label(main_frame,
                                text="",
                                fg='#FF4444',
                                bg='#1E1E1E',
                                font=('Segoe UI', 8))
    
    # Buttons frame
    button_frame = tk.Frame(main_frame, bg='#1E1E1E')
    button_frame.pack(pady=(0, 15))
    
    # Button style
    retry_btn = tk.Button(button_frame,
                         text="🔄 Retry",
                         command=retry_connection,
                         bg='#333333',
                         fg='#FFFFFF',
                         activebackground='#404040',
                         activeforeground='#FFFFFF',
                         relief='flat',
                         font=('Segoe UI', 9),
                         width=10)
    retry_btn.pack(side='left', padx=5)
    
    ok_btn = tk.Button(button_frame,
                      text="🚫 OK",
                      command=close_app,
                      bg='#333333',
                      fg='#FFFFFF',
                      activebackground='#404040',
                      activeforeground='#FFFFFF',
                      relief='flat',
                      font=('Segoe UI', 9),
                      width=10)
    ok_btn.pack(side='left', padx=5)
    
    # Center window
    dialog.update_idletasks()
    screen_width = dialog.winfo_screenwidth()
    screen_height = dialog.winfo_screenheight()
    x = (screen_width - dialog_width) // 2
    y = (screen_height - dialog_height) // 2
    dialog.geometry(f"+{x}+{y}")
    
    # Make window draggable
    def start_move(event):
        dialog.x = event.x
        dialog.y = event.y

    def stop_move(event):
        dialog.x = None
        dialog.y = None

    def do_move(event):
        deltax = event.x - dialog.x
        deltay = event.y - dialog.y
        x = dialog.winfo_x() + deltax
        y = dialog.winfo_y() + deltay
        dialog.geometry(f"+{x}+{y}")

    title_frame.bind('<Button-1>', start_move)
    title_frame.bind('<ButtonRelease-1>', stop_move)
    title_frame.bind('<B1-Motion>', do_move)
    
    # Auto-check connection every 5 seconds
    def auto_check_connection():
        if check_internet_connection():
            # Show success message and close
            message_label.config(text="📶 Connection detected!\nStarting the program...", fg='#00FF00')
            dialog.after(1500, dialog.destroy)
        else:
            dialog.after(5000, auto_check_connection)  # Check again in 5 seconds
    
    # Start auto-checking
    auto_check_connection()
    
    dialog.mainloop()

def load_game_history():
    """Load game history from file"""
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, 'r') as f:
                return json.load(f)
        except:
            return {"history": []}
    return {"history": []}

def save_game_history(history):
    """Save game history to file"""
    try:
        with open(HISTORY_FILE, 'w') as f:
            json.dump(history, f)
        return True
    except Exception as e:
        print(f"Error saving game history: {e}")
        return False

@app.route('/api/game-history', methods=['GET', 'POST', 'DELETE'])
def manage_game_history():
    if request.method == 'GET':
        return jsonify(load_game_history())
    
    elif request.method == 'POST':
        data = request.get_json()
        history = load_game_history()
        
        # Remove if exists
        history['history'] = [g for g in history['history'] if g['id'] != data['id']]
        
        # Add to beginning
        history['history'].insert(0, {
            'id': data['id'],
            'name': data['name'],
            'image': data['image'],
            'addedAt': datetime.now().isoformat()
        })
        
        # Keep only last 50 games
        history['history'] = history['history'][:50]
        
        save_game_history(history)
        return jsonify(history)
    
    elif request.method == 'DELETE':
        data = request.get_json()
        history = load_game_history()
        
        if data.get('clearAll'):
            # Clear all history
            history['history'] = []
        else:
            # Remove specific game
            history['history'] = [g for g in history['history'] if g['id'] != data['gameId']]
        
        save_game_history(history)
        return jsonify(history)

def load_game_favorites():
    if os.path.exists(GAME_FAVORITES_FILE):
        try:
            with open(GAME_FAVORITES_FILE, 'r') as f:
                return json.load(f)
        except:
            return {"favorites": []}
    return {"favorites": []}

def save_game_favorites(favorites):
    with open(GAME_FAVORITES_FILE, 'w') as f:
        json.dump(favorites, f)

@app.route('/api/game-favorites', methods=['GET', 'POST', 'DELETE'])
def manage_game_favorites():
    if request.method == 'GET':
        return jsonify(load_game_favorites())
    
    elif request.method == 'POST':
        data = request.get_json()
        favorites = load_game_favorites()
        
        # Check if game is already in favorites
        existing = next((g for g in favorites['favorites'] if g['id'] == data['id']), None)
        
        if existing:
            # Remove from favorites
            favorites['favorites'] = [g for g in favorites['favorites'] if g['id'] != data['id']]
            message = f"Removed {data['name']} from favorites"
        else:
            # Add to favorites
            favorites['favorites'].append({
                'id': data['id'],
                'name': data['name'],
                'image': data['image'],
                'addedAt': datetime.now().isoformat()
            })
            message = f"Added {data['name']} to favorites"
        
        save_game_favorites(favorites)
        return jsonify({"favorites": favorites['favorites'], "message": message})
    
    elif request.method == 'DELETE':
        data = request.get_json()
        favorites = load_game_favorites()
        
        if data.get('clearAll'):
            # Clear all favorites
            favorites['favorites'] = []
        else:
            # Remove specific game
            favorites['favorites'] = [g for g in favorites['favorites'] if g['id'] != data['gameId']]
        
        save_game_favorites(favorites)
        return jsonify({"favorites": favorites['favorites']})

# Add new functions for export preferences
def get_export_preferences_path():
    return os.path.join(APPDATA_PATH, 'export_preferences.json')

def load_export_preferences():
    prefs_file = get_export_preferences_path()
    if os.path.exists(prefs_file):
        with open(prefs_file, 'r') as f:
            return json.load(f)
    return {
        'game_id': True,
        'game_name': True,
        'store_url': False,
        'time_hhmmss': True,
        'hours': True,
        'percentage': False,
        'rank': True,
        'status': False,
        'session': False,
        'favorite': False
    }

@app.route('/api/export-preferences', methods=['GET'])
def get_export_preferences():
    try:
        preferences = load_export_preferences()
        return jsonify(preferences)
    except Exception as e:
        print(f"Error loading export preferences: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/export-preferences', methods=['POST'])
def save_export_preferences():
    try:
        preferences = request.get_json()
        prefs_file = get_export_preferences_path()
        with open(prefs_file, 'w') as f:
            json.dump(preferences, f)
        return jsonify({"status": "success"})
    except Exception as e:
        print(f"Error saving export preferences: {str(e)}")
        return jsonify({"status": "error", "message": str(e)}), 500

def detect_running_games():
    """Detect already running steam-idle processes and add them to running_games"""
    detected_games = []
    detected_game_info = []  # Store full game info for UI updates
    
    if icon:
        icon.notify("🔍 Scanning for running games...", "Detection Started")
    
    try:
        current_time = datetime.now()
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                if proc.name().lower() == 'steam-idle.exe':
                    cmdline = proc.cmdline()
                    if len(cmdline) > 1:
                        game_id = cmdline[1]  # The game ID is passed as the first argument
                        if game_id not in running_games:
                            process = proc
                            running_games[game_id] = process.pid
                            
                            try:
                                # Get process creation time for accurate session tracking
                                process_create_time = datetime.fromtimestamp(process.create_time())
                            except:
                                # If we can't get creation time, use current time
                                process_create_time = current_time
                            
                            # Initialize game session and get game info
                            if game_id not in game_sessions:
                                game_info = fetch_game_info(game_id)
                                game_sessions[game_id] = {
                                    'total_time': 0,
                                    'name': game_info['name'],
                                    'image': game_info['image'],
                                    'start_time': process_create_time  # Use actual process start time
                                }
                                detected_game_info.append(game_info)  # Store full game info
                            else:
                                # Update existing session with correct start time
                                game_sessions[game_id]['start_time'] = process_create_time
                                # Add existing game info
                                detected_game_info.append({
                                    'id': game_id,
                                    'name': game_sessions[game_id]['name'],
                                    'image': game_sessions[game_id]['image']
                                })
                            
                            detected_games.append(game_id)
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
    except Exception as e:
        print(f"Error detecting running games: {e}")
        if icon:
            icon.notify(f"❌ Error detecting games: {str(e)}", "Error")
        return []
    
    if detected_games:
        # Save statistics
        save_statistics()
        
        # Update Discord RPC
        if DISCORD_RPC_ENABLED:
            try:
                update_discord_rpc()
            except Exception as e:
                print(f"Error updating Discord RPC: {e}")
        
        # Update tray menu to show current games
        try:
            update_tray_menu()
        except Exception as e:
            print(f"Error updating tray menu: {e}")
        
        if icon:
            icon.notify(f"✅ Successfully detected {len(detected_games)} running games", "Detection Complete")
    else:
        if icon:
            icon.notify("ℹ️ No running games detected", "Detection Complete")
    
    return detected_games, detected_game_info

def on_loaded():
    """Called when the window is fully loaded"""
    # Detect already running games
    detected_games, detected_game_info = detect_running_games()
    if detected_games:
        print(f"Detected {len(detected_games)} running games")
        # Update UI to show detected games
        window.evaluate_js("""
            // Show loading notification
            showNotification('🔄 Adding detected games to library...', 'info');
            
            // Add games to currentGames array if not already present
            %s.forEach(game => {
                if (!currentGames.some(g => g.id === game.id)) {
                    currentGames.push(game);
                }
            });
            
            // Update running games
            runningGames.clear();
            %s.forEach(gameId => runningGames.add(gameId));
            
            // Update all UI elements
            updateGamesList();
            loadPresets(true).then(presets => {
                updatePresetsList(presets);
                updateRunningGamesList();
                // Show success notification
                showNotification('✅ Successfully added ' + %d + ' games to library', 'success');
            });
        """ % (json.dumps(detected_game_info), json.dumps(detected_games), len(detected_games)))

def update_and_save_statistics():
    """Update and save statistics periodically"""
    while True:
        try:
            if running_games:
                current_time = datetime.now()
                stats_updated = False

                # Update session times for running games
                for game_id in list(running_games.keys()):
                    if game_id in game_sessions and 'start_time' in game_sessions[game_id]:
                        # Calculate current session duration
                        session_duration = (current_time - game_sessions[game_id]['start_time']).total_seconds()
                        
                        # Create a temporary copy of the session
                        temp_session = game_sessions[game_id].copy()
                        
                        # Update total_time in the temporary session
                        temp_session['total_time'] = game_sessions[game_id].get('total_time', 0)
                        temp_session['total_time'] += session_duration
                        
                        # Save the temporary session to the statistics file
                        stats_data = load_statistics()
                        if 'game_sessions' not in stats_data:
                            stats_data['game_sessions'] = {}
                        
                        stats_data['game_sessions'][game_id] = {
                            'total_time': temp_session['total_time'],
                            'name': temp_session.get('name', 'Unknown Game'),
                            'image': temp_session.get('image', '')
                        }
                        
                        with open(STATS_FILE, 'w') as f:
                            json.dump(stats_data, f)
                        
                        stats_updated = True
                
                if stats_updated:
                    print(f"Statistics auto-saved at {current_time.strftime('%H:%M:%S')}")
        except Exception as e:
            print(f"Error in statistics auto-save: {e}")
        
        time.sleep(60)  # Update every minute

if __name__ == '__main__':
    # Check for internet connection before starting the app
    while not check_internet_connection():
        show_no_internet_error()
    
    # Initialize settings
    settings = load_settings()
    minimize_to_tray = settings.get('minimize_to_tray', False)
    AUTO_RECONNECT = settings.get('auto_reconnect', False)
    
    # Create window first with loaded callback
    window = webview.create_window('Steam Idle Manager', app, minimized=False, width=1440, height=1000)
    window.events.loaded += on_loaded
    
    # Set the window event handlers
    window.events.closed += on_closed
    window.events.minimized += handle_minimize_event
    
    # Create tray icon
    create_tray_icon()
    
    # Start the auto-reconnect checker thread
    reconnect_thread = threading.Thread(target=check_and_restart_games)
    reconnect_thread.daemon = True
    reconnect_thread.start()
    
    # Start the game goals checker thread
    goals_thread = threading.Thread(target=check_game_goals)
    goals_thread.daemon = True
    goals_thread.start()
    
    # Start the tray menu update thread
    tray_update_thread = threading.Thread(target=update_tray_periodically)
    tray_update_thread.daemon = True
    tray_update_thread.start()
    
    # Start the statistics auto-save thread
    stats_thread = threading.Thread(target=update_and_save_statistics)
    stats_thread.daemon = True
    stats_thread.start()
    
    try:
        # Start the application
        webview.start()
    finally:
        # Save final statistics before closing
        try:
            if running_games:
                current_time = datetime.now()
                for game_id in list(running_games.keys()):
                    if game_id in game_sessions and 'start_time' in game_sessions[game_id]:
                        session_duration = (current_time - game_sessions[game_id]['start_time']).total_seconds()
                        game_sessions[game_id]['total_time'] = game_sessions[game_id].get('total_time', 0) + session_duration
                save_statistics()
                print("Final statistics saved before exit")
        except Exception as e:
            print(f"Error saving final statistics: {e}")
        
        # Clean up tray icon and Discord RPC when exiting
        if icon:
            try:
                icon.stop()
            except:
                pass