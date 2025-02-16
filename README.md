# Steam Idle Manager

<div align="center">
  <img src="Logo.png" alt="Steam Idle Manager Logo" width="200"/>
  
  ![Python](https://img.shields.io/badge/Python-3.8%2B-blue)
  ![Flask](https://img.shields.io/badge/Flask-2.0.1-green)
  ![License](https://img.shields.io/badge/License-MIT-yellow)
  [![Developer](https://img.shields.io/badge/Developer-ZerroDevs-purple)](https://github.com/ZerroDevs)

  A powerful and feature-rich Steam game idling manager with a modern UI and extensive functionality.
</div>

## ✨ Features

### Core Features
- 🎮 **Game Management**
  - Add and manage multiple Steam games
  - Real-time game status monitoring
  - Automatic game info fetching from Steam
  - Track individual and total playtime

- 📋 **Preset System**
  - Create and save game presets
  - Import/Export presets via BAT files
  - Quick launch multiple games simultaneously
  - Favorite presets for easy access

- 📊 **Statistics & Tracking**
  - Total playtime tracking
  - Most idled games tracking
  - Playtime history (Daily/Weekly/Monthly)
  - Export statistics to CSV

### Advanced Features
- ⚡ **Quick Actions Panel**
  - Favorite presets access
  - Recent actions history
  - Custom keyboard shortcuts
  - Emergency stop functionality

- ⏰ **Scheduling System**
  - Schedule preset launches
  - Set specific days and times
  - Automatic start/stop
  - Multiple schedule support

- 🔄 **Auto-Reconnect**
  - Automatic game crash detection
  - Instant game relaunch
  - Configurable reconnect intervals
  - Status notifications

### System Integration
- 🖥️ **System Tray Integration**
  - Minimize to system tray
  - Quick access menu
  - Status notifications
  - Background operation

- 🚀 **Startup Options**
  - Launch with Windows
  - Minimize on startup
  - Configurable startup behavior
  - Silent background launch

## 🚀 Getting Started

### Prerequisites
- Windows OS
- Python 3.8 or higher
- Steam Client installed
- Steam Idle executable

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/ZerroDevs/SteamIdle.git
   ```

2. Install required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the application:
   ```bash
   python steam_idle_manager.py
   ```

### First-Time Setup
1. Launch the application
2. Complete the welcome configuration:
   - Select your `steam-idle.exe` location
   - Configure startup preferences
   - Set minimize to tray options
3. Start managing your Steam games!

## 🛠️ Configuration

### Settings
- **Theme Selection**: Choose between light and dark themes
- **Startup Options**: Configure Windows startup behavior
- **System Tray**: Enable/disable minimize to tray
- **Auto-Reconnect**: Configure automatic game reconnection
- **Steam Idle Path**: Manage steam-idle.exe location

### Keyboard Shortcuts
Create custom shortcuts for:
- Starting presets
- Stopping games
- Emergency stop
- Quick actions

## 📊 Statistics

### Tracking Features
- Total playtime across all games
- Individual game playtime
- Session duration tracking
- Historical data visualization

### Export Options
- Export to CSV format
- Detailed game statistics
- Historical data
- Custom date ranges

## 🔧 Technical Details

### Built With
- **Frontend**: HTML5, TailwindCSS, JavaScript
- **Backend**: Python, Flask
- **Database**: JSON-based file storage
- **UI Framework**: WebView

### System Requirements
- **OS**: Windows 10/11
- **Memory**: 2GB RAM minimum
- **Storage**: 100MB free space
- **Dependencies**: Steam Client

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Developer

**ZerroDevs**
- GitHub: [@ZerroDevs](https://github.com/ZerroDevs)

## 🙏 Acknowledgments

- Steam API for game information
- Idle Master Extended for inspiration
- TailwindCSS for the UI framework
- Flask for the backend framework

---

<div align="center">
  Made with ❤️ by ZerroDevs
</div> 