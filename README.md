# Full Remote PC Control Frontend

This project is a modern frontend application that connects to a Python-based FastAPI backend remote control agent running on a PC. It allows users to monitor, control, and interact with their PC remotely from anywhere using a secure token-based API.

## Architecture Diagram

```
+----------------+          +-----------------------+          +----------------+
|                |  Token   |                       |  Token   |                |
|  Frontend App  +---------->  FastAPI Backend API  +---------->  Remote PC     |
|  (React + Tailwind)        |  (Python FastAPI)     |          |  Agent         |
|                |          |                       |          |                |
+----------------+          +-----------------------+          +----------------+
```

The frontend communicates securely with the backend API using token-based authentication to perform remote PC control operations.

## Features

### Login Page
- Input fields for IP address and token
- Save and auto-reuse connection settings for future sessions
- Validate connection using the `/stats` endpoint

### Dashboard
- Displays system statistics including CPU, RAM, Disk, Battery, and OS information
- Auto-refreshes every 5–10 seconds
- Visual charts and usage bars for easy monitoring  
  *Example charts: CPU usage line chart, RAM usage bar chart, Disk usage pie chart*

### File Explorer
- View drives and navigate folders using `/files/list` endpoint
- Displays folder/file icons, size, and last modified time
- Breadcrumb navigation for easy folder traversal
- File download functionality via `/files/download`
- Optional file preview popup for images and text files

### Screenshot Page
- Shows the current PC screenshot from `/screenshot`
- Refresh and download options for the screenshot image

### Command Executor
- Input box to run shell commands remotely (e.g., `ipconfig`, `ls`)
- Displays command output or errors in a styled terminal-like box
- Uses `/command` endpoint with token authentication

### Control Panel
- Buttons to shutdown or reboot the PC (`/control/shutdown` and `/control/reboot`)
- Confirmation popups before executing critical actions

## API Integration

| Endpoint               | Purpose                          |
|------------------------|---------------------------------|
| `/stats`               | Get system information           |
| `/screenshot`          | Get latest screen image          |
| `/files/list?path=...` | List folders/files in directory  |
| `/files/download`      | Download file                   |
| `/command`             | Run a shell command             |
| `/control/shutdown`    | Shut down the PC                |
| `/control/reboot`      | Reboot the PC                  |

All endpoints require a token passed as a query parameter or in the `X-API-Token` header for authentication.

## Design

- Clean, minimal UI inspired by Windows 11 and modern developer tools
- Supports both light and dark modes
- Responsive layout for mobile and desktop devices
- Uses cards, tabs, or sidebar for navigation
- Icons for folders, drives, and actions (using Material Icons or FontAwesome)
- Optional animations such as fade and slide transitions

## Tech Stack

- React for building UI components
- Tailwind CSS for styling and responsive design
- Axios for API requests and token management

## Folder Structure

```
/src
  /components      # React components for pages and UI elements
  /services        # API service utilities for backend communication
  /styles          # Tailwind CSS and custom styles
/public
  index.html       # Main HTML file
README.md          # Project documentation
```

## Future Directions and Ideas by the Author

- Remember connection settings using localStorage or SQLite for multi-device support
- Support multiple PC connections with easy switching
- Auto-connect to default agent on app startup
- Enhanced error messages and loading indicators for better UX
- Responsive animations and transitions for smoother interactions
- File preview enhancements for more file types
- Mobile app version using Flutter or React Native
- Add real-time notifications for system alerts and command results
- Integrate voice control for hands-free PC management
- Implement user roles and permissions for multi-user environments
- Add support for remote audio streaming and control
- Provide customizable dashboard widgets for personalized monitoring

## Running Locally

1. Clone the repository
2. Install dependencies (e.g., `npm install` if using React)
3. Configure the backend IP address and token in the app settings
4. Run the development server (e.g., `npm start`)
5. Open the app in your browser and login to start controlling your PC remotely

---

This frontend app works in conjunction with a Python FastAPI backend agent that exposes secure token-based APIs for remote PC control.

## Author

Developed by AI Assistant with user collaboration.
