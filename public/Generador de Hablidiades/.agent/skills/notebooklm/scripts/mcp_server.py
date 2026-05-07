from fastmcp import FastMCP
import subprocess
import json
import os
import sys

# Initialize FastMCP
mcp = FastMCP("NotebookLM")

# Get paths
current_dir = os.path.dirname(os.path.abspath(__file__))
# run.py is in the same directory as this script
run_script = os.path.join(current_dir, 'run.py')
# library path
library_path = os.path.join(os.path.dirname(current_dir), 'data', 'library.json')

def run_notebook_command(script_name, args):
    """Helper to run notebooklm scripts"""
    cmd = [sys.executable, run_script, script_name] + args
    
    # Run synchronously
    try:
        result = subprocess.run(
            cmd, 
            capture_output=True, 
            text=True, 
            encoding='utf-8',
            check=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        return f"Error executing command: {e.stderr}"
    except Exception as e:
        return f"Unexpected error: {str(e)}"

@mcp.tool()
def query_notebook(question: str, notebook_id: str = None) -> str:
    """
    Query NotebookLM with a question.
    
    Args:
        question: The question to ask.
        notebook_id: Optional ID of the notebook to query. If not provided, uses the last active notebook.
    """
    args = ["--question", question]
    if notebook_id:
        args.extend(["--notebook-id", notebook_id])
    
    return run_notebook_command("ask_question.py", args)

@mcp.tool()
def list_notebooks() -> str:
    """
    List all available notebooks in the library. 
    Returns a formatted list of notebooks with their IDs and names.
    """
    return run_notebook_command("notebook_manager.py", ["list"])

@mcp.tool()
def add_notebook(url: str, name: str, description: str, topics: str) -> str:
    """
    Add a new notebook to the library.
    
    Args:
        url: The full NotebookLM URL.
        name: A descriptive name for the notebook.
        description: A brief description of the notebook's content.
        topics: Comma-separated list of topics (e.g., "coding, finance").
    """
    args = [
        "add",
        "--url", url,
        "--name", name,
        "--description", description,
        "--topics", topics
    ]
    return run_notebook_command("notebook_manager.py", args)

if __name__ == "__main__":
    mcp.run()
