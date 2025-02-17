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

import csv
import time
import re

# Initialize Flask app
app = Flask(__name__)

# Global variables
icon = None
IDLER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "steam-idle.exe")
minimize_to_tray = False
AUTO_RECONNECT = False

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

# Create necessary directories if they don't exist
if not os.path.exists(APPDATA_PATH):
    os.makedirs(APPDATA_PATH)
if not os.path.exists(PRESETS_DIR):
    os.makedirs(PRESETS_DIR)

running_games = {}
game_sessions = {}  # Store game session data: {game_id: {'start_time': datetime, 'total_time': seconds}}

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
                global IDLER_PATH, minimize_to_tray, AUTO_RECONNECT
                
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
                
                # Ensure theme setting exists
                if 'theme' not in settings:
                    settings['theme'] = 'dark'  # Default theme
                    save_settings(settings)
                
                return settings
        except Exception as e:
            print(f"Error loading settings: {e}")
            return {'setup_completed': False, 'theme': 'dark'}
    return {'setup_completed': False, 'theme': 'dark'}

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
            "message": "Steam is not running"
        }
    
    # Check if Steam is online by attempting to access the Steam Web API
    try:
        response = requests.get("https://steamcommunity.com/", timeout=5)
        if response.status_code == 200:
            return {
                "running": True,
                "online": True,
                "message": "Steam is running and online"
            }
        else:
            return {
                "running": True,
                "online": False,
                "message": "Steam is running but appears to be offline"
            }
    except:
        return {
            "running": True,
            "online": False,
            "message": "Steam is running but appears to be offline"
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
                return {"error": "Game not found"}
            
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
        return {"error": "Error fetching game info"}

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
        return jsonify({"error": "Please provide a game ID or name"})
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
        "message": "Steam launch initiated" if success else "Failed to launch Steam"
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
            "message": "Steam is not running. Please start Steam first.",
            "steam_status": steam_status
        }), 400
    
    if not steam_status['online']:
        return jsonify({
            "status": "error", 
            "message": "Steam appears to be offline. Please ensure Steam is online.",
            "steam_status": steam_status
        }), 400
    
    # Check if game is already running
    if game_id in running_games:
        return jsonify({"status": "error", "message": "Game is already running"}), 400
    
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
        return jsonify({"status": "error", "message": "Game is not running"}), 400
    
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
            "message": "Steam is not running. Please start Steam first.",
            "steam_status": steam_status
        }), 400
    
    if not steam_status['online']:
        return jsonify({
            "status": "error", 
            "message": "Steam appears to be offline. Please ensure Steam is online.",
            "steam_status": steam_status
        }), 400
    
    # Get the preset data from JSON file
    json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
    if not os.path.exists(json_path):
        return jsonify({"status": "error", "message": "Preset not found"}), 404
        
    try:
        # Read the games from the preset
        with open(json_path, 'r') as f:
            games = json.load(f)
        
        # Start each game
        for game in games:
            game_id = str(game['id'])
            if game_id not in running_games:  # Only start if not already running
                process = subprocess.Popen([IDLER_PATH, game_id], shell=True)
                running_games[game_id] = process.pid
                
                # Initialize or update game session
                if game_id not in game_sessions:
                    game_sessions[game_id] = {
                        'total_time': 0,
                        'name': game['name'],
                        'image': game['image']
                    }
                game_sessions[game_id]['start_time'] = datetime.now()
                
                # Save statistics after each game is started
                save_statistics()
        
        # Update tray menu
        update_tray_menu()
        
        return jsonify({
            "status": "success",
            "gameIds": [game['id'] for game in games],
            "runningGames": list(running_games.keys())
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

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
    
    return jsonify({
        "total_time": format_duration(total_seconds),
        "total_seconds": total_seconds
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
        
        # Get game info
        game_info = None
        for preset in os.listdir(PRESETS_DIR):
            if preset.endswith('.json'):
                with open(os.path.join(PRESETS_DIR, preset), 'r') as f:
                    preset_data = json.load(f)
                    for game in preset_data:
                        if str(game['id']) == str(game_id):
                            game_info = game
                            break
                    if game_info:
                        break
        
        if game_info:
            games_list.append({
                "id": game_id,
                "name": game_info['name'],
                "image": game_info['image'],
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
    
    save_recent_action(f"Emergency stop - Stopped {len(stopped_games)} games")
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
    global icon
    if not icon:
        return

    try:
        menu_items = []
        
        # Add Show option
        menu_items.append(pystray.MenuItem("Show", show_window))
        menu_items.append(pystray.Menu.SEPARATOR)
        
        # Create Running Games submenu
        if running_games:
            running_count = len(running_games)
            running_games_items = []
            
            # Add running games count
            running_games_items.append(
                pystray.MenuItem(f"Running: {running_count} game{'s' if running_count != 1 else ''}", 
                               None, enabled=False)
            )
            running_games_items.append(pystray.Menu.SEPARATOR)
            
            # Add most idled game info
            most_idled = get_most_idled_game()
            if most_idled != "None":
                running_games_items.append(
                    pystray.MenuItem(f"Most Idled: {most_idled}", None, enabled=False)
                )
                running_games_items.append(pystray.Menu.SEPARATOR)
            
            # Add individual running games with playtime
            for game_id in running_games:
                if game_id in game_sessions:
                    game_info = game_sessions[game_id]
                    playtime = get_game_playtime(game_id)
                    menu_item = pystray.MenuItem(
                        f"{game_info['name']} ({playtime})",
                        lambda item, g_id=game_id: stop_single_game_tray(icon, item, g_id)
                    )
                    running_games_items.append(menu_item)
            
            # Add Running Games submenu to main menu
            menu_items.append(pystray.MenuItem("Running Games", pystray.Menu(*running_games_items)))
            menu_items.append(pystray.Menu.SEPARATOR)
        
        # Add Favorites submenu
        favorites = load_favorites()
        if favorites.get('favorites', []):
            favorites_items = []
            for favorite in favorites['favorites']:
                favorites_items.append(pystray.MenuItem(favorite['name'], 
                    lambda item, name=favorite['name']: run_preset_tray(icon, item, name)))
            menu_items.append(pystray.MenuItem("Favorites", pystray.Menu(*favorites_items)))
        
        # Add Presets submenu
        presets = []
        if os.path.exists(PRESETS_DIR):
            for filename in os.listdir(PRESETS_DIR):
                if filename.endswith('.json'):
                    preset_name = filename[:-5]
                    presets.append(pystray.MenuItem(preset_name, 
                        lambda item, name=preset_name: run_preset_tray(icon, item, name)))
            if presets:
                menu_items.append(pystray.MenuItem("Presets", pystray.Menu(*presets)))
        
        # Add remaining menu items
        menu_items.append(pystray.Menu.SEPARATOR)
        menu_items.append(pystray.MenuItem("Launch Steam", launch_steam_tray, 
                                         enabled=lambda item: not is_steam_running()))
        menu_items.append(pystray.Menu.SEPARATOR)
        menu_items.append(pystray.MenuItem("Emergency Stop", emergency_stop_tray, 
                                         enabled=lambda item: bool(running_games)))
        menu_items.append(pystray.Menu.SEPARATOR)
        menu_items.append(pystray.MenuItem("Exit", exit_app))
        
        # Create the menu tuple with only non-None items
        menu = pystray.Menu(*[item for item in menu_items if item is not None])
        
        # Update the icon's menu
        icon.menu = menu

    except Exception as e:
        print(f"Error updating tray menu: {e}")

def create_tray_icon():
    global icon
    try:
        # Load the icon image
        image = Image.open(resource_path("Logo.png"))
        
        # Create initial menu with basic items
        initial_menu = (
            pystray.MenuItem("Show", show_window),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit", exit_app)
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
                icon.notify("Steam Idle Manager is still running in the background", "Minimized to Tray")
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
            icon.notify("Steam Idle Manager is still running in the background", "Minimized to Tray")
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
            icon.notify(f"Game {game_id} was restarted automatically", "Auto-Reconnect")
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
                            f"Game {session.get('name', game_id)} has reached the target playtime of {target_hours} hours!",
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
        export_type = data.get('type', 'csv')
        
        # Prepare statistics data
        stats = []
        current_time = datetime.now()
        
        for game_id, session in game_sessions.items():
            total_seconds = session.get('total_time', 0)
            
            # Add current session time if game is running
            if game_id in running_games and 'start_time' in session:
                current_session = (current_time - session['start_time']).total_seconds()
                total_seconds += current_session
            
            stats.append({
                'game_id': game_id,
                'name': session.get('name', 'Unknown Game'),
                'total_time': format_duration(total_seconds),
                'total_hours': round(total_seconds / 3600, 2)
            })
        
        # Export to CSV
        if export_type == 'csv':
            filename = f"steam_idle_stats_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            filepath = os.path.join(APPDATA_PATH, filename)
            
            with open(filepath, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=['game_id', 'name', 'total_time', 'total_hours'])
                writer.writeheader()
                writer.writerows(stats)
            
            # Return file as attachment
            return send_file(
                filepath,
                as_attachment=True,
                download_name=filename,
                mimetype='text/csv'
            )
    except Exception as e:
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
    global minimize_to_tray, AUTO_RECONNECT
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
    
    save_recent_action(f"Emergency stop from tray - Stopped {len(stopped_games)} games")
    save_statistics()
    if icon:
        icon.notify(f"Stopped {len(stopped_games)} games", "Emergency Stop")
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
            icon.notify(f"Stopped {game_sessions[game_id]['name']}", "Game Stopped")
            save_recent_action(f"Stopped game {game_sessions[game_id]['name']} from tray")
            update_tray_menu()
    except Exception as e:
        icon.notify(f"Error stopping game: {str(e)}", "Error")

def run_preset_tray(icon, item, preset_name):
    """Run a preset from the system tray menu"""
    # Check Steam status first
    steam_status = check_steam_status()
    if not steam_status['running']:
        icon.notify("Steam is not running. Please start Steam first.", "Error")
        return
    
    if not steam_status['online']:
        icon.notify("Steam appears to be offline. Please ensure Steam is online.", "Error")
        return
    
    try:
        # Get the preset data from JSON file
        json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
        if not os.path.exists(json_path):
            icon.notify(f"Preset {preset_name} not found", "Error")
            return
            
        with open(json_path, 'r') as f:
            games = json.load(f)
        
        # Start each game
        started_games = 0
        for game in games:
            game_id = str(game['id'])
            if game_id not in running_games:  # Only start if not already running
                process = subprocess.Popen([IDLER_PATH, game_id], shell=True)
                running_games[game_id] = process.pid
                started_games += 1
                
                # Initialize or update game session
                if game_id not in game_sessions:
                    game_sessions[game_id] = {
                        'total_time': 0,
                        'name': game['name'],
                        'image': game['image']
                    }
                game_sessions[game_id]['start_time'] = datetime.now()
        
        save_statistics()
        icon.notify(f"Started {started_games} games from preset {preset_name}", "Preset Started")
        save_recent_action(f"Started preset {preset_name} from tray")
        update_tray_menu()
    except Exception as e:
        icon.notify(f"Error running preset: {str(e)}", "Error")

def launch_steam_tray(icon, item):
    steam_path = get_steam_path()
    if steam_path:
        try:
            steam_exe = os.path.join(steam_path, "Steam.exe")
            if os.path.exists(steam_exe):
                subprocess.Popen([steam_exe])
                icon.notify("Steam launch initiated", "Steam")
                save_recent_action("Launched Steam from tray")
            else:
                icon.notify("Steam executable not found", "Error")
        except Exception as e:
            icon.notify(f"Error launching Steam: {str(e)}", "Error")
    else:
        icon.notify("Steam installation not found", "Error")

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
            return {"error": "Steam ID not found. Please make sure you're logged into Steam."}

        # Get installed games from Steam installation
        steam_path = get_steam_path()
        if not steam_path:
            return {"error": "Steam installation not found"}

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
            return jsonify({"error": "Missing game IDs or preset name"}), 400

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
        return jsonify({"status": "error", "message": "Game is not running"}), 400
    
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
        return jsonify({"status": "error", "message": "Game process not found"}), 404
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

# Add resume game route for future use
@app.route('/api/resume-game', methods=['POST'])
def resume_game():
    data = request.get_json()
    game_id = str(data.get('gameId'))
    
    if game_id not in running_games:
        return jsonify({"status": "error", "message": "Game is not running"}), 400
    
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
        return jsonify({"status": "error", "message": "Game process not found"}), 404
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
            message_label.config(text="Connection detected!\nStarting the program...", fg='#00FF00')
            dialog.after(1500, dialog.destroy)  # Close after 1.5 seconds
            return True
        else:
            # Show the notification label with animation
            notification_label.config(text="There's no connection")
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
                           text="No internet connection detected!\n\nPlease check your connection and try again.",
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
                         text="Retry",
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
                      text="OK",
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
            message_label.config(text="Connection detected!\nStarting the program...", fg='#00FF00')
            dialog.after(1500, dialog.destroy)
        else:
            dialog.after(5000, auto_check_connection)  # Check again in 5 seconds
    
    # Start auto-checking
    auto_check_connection()
    
    dialog.mainloop()

if __name__ == '__main__':
    # Check for internet connection before starting the app
    while not check_internet_connection():
        show_no_internet_error()
    
    # Initialize settings
    settings = load_settings()
    minimize_to_tray = settings.get('minimize_to_tray', False)
    
    # Create window
    window = webview.create_window('Steam Idle Manager', app, minimized=False, width=1440, height=1000)
    
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
    
    # Start the application
    webview.start()
    
    # Clean up tray icon when exiting
    if icon:
        icon.stop() 