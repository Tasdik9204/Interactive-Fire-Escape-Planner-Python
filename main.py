# fire_escape/main.py
import tkinter as tk
from gui import FireEscapeApp

if __name__ == "__main__":
    root = tk.Tk()
    root.geometry("1100x700")
    app = FireEscapeApp(root)
    root.mainloop()
