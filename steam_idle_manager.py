import os
import sys
import json
import subprocess
import webview
import requests
import psutil
import winreg
from flask import Flask, render_template, request, jsonify
from bs4 import BeautifulSoup
from datetime import datetime

app = Flask(__name__)
window = None

PRESETS_DIR = "presets"
IDLER_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Idler", "steam-idle.exe")
running_games = {}
game_sessions = {}  # Store game session data: {game_id: {'start_time': datetime, 'total_time': seconds}}

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

if not os.path.exists(PRESETS_DIR):
    os.makedirs(PRESETS_DIR)

def format_duration(seconds):
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    seconds = seconds % 60
    return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}"

def fetch_game_info(game_id):
    try:
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
        return {
            "id": game_id,
            "name": "Error fetching game info",
            "image": ""
        }

@app.route('/')
def home():
    return render_template('index.html')

@app.route('/api/fetch-game', methods=['POST'])
def fetch_game():
    data = request.get_json()
    game_id = data.get('gameId')
    return jsonify(fetch_game_info(game_id))

@app.route('/api/save-preset', methods=['POST'])
def save_preset():
    data = request.get_json()
    preset_name = data.get('name')
    games = data.get('games', [])
    
    # Save preset as JSON
    preset_json_path = os.path.join(PRESETS_DIR, f"{preset_name}.json")
    with open(preset_json_path, 'w') as f:
        json.dump(games, f)
    
    # Create BAT file
    bat_content = "@echo off\n"
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
            game_sessions[game_id] = {'total_time': 0}
        game_sessions[game_id]['start_time'] = datetime.now()
        
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
        
        del running_games[game_id]
        return jsonify({"status": "success"})
    except psutil.NoSuchProcess:
        # If process is already gone, just remove it from our tracking
        del running_games[game_id]
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
                    game_sessions[game_id] = {'total_time': 0}
                game_sessions[game_id]['start_time'] = datetime.now()
        
        return jsonify({
            "status": "success",
            "gameIds": [game['id'] for game in games],
            "runningGames": list(running_games.keys())
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    window = webview.create_window('Steam Idle Manager', app)
    webview.start() 