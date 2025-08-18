import tkinter as tk
from tkinter import ttk, messagebox, simpledialog
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import matplotlib.pyplot as plt
import threading
import time

from engine import FireEscapeEngine
from styles import *

class FireEscapeApp:
    def __init__(self, root):
        self.root = root
        self.root.title("🔥 Fire Escape Planner & Simulation")
        self.engine = FireEscapeEngine(self)
        self.create_ui()
        self.engine.load_default_map()
        self.engine.redraw()
        self.update_node_dropdown()

    def create_ui(self):
        frame = tk.Frame(self.root, bg=BACKGROUND)
        frame.pack(fill=tk.BOTH, expand=True)

        # Left: Graph canvas
        canvas_frame = tk.Frame(frame)
        canvas_frame.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        self.fig, self.ax = plt.subplots(figsize=(6, 6))
        self.canvas = FigureCanvasTkAgg(self.fig, master=canvas_frame)
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)

        # Right: Controls
        control = tk.Frame(frame, bg=PANEL_BG, padx=10, pady=10)
        control.pack(side=tk.RIGHT, fill=tk.Y)

        tk.Label(control, text="🔥 Fire Escape Controls", bg=PANEL_BG, fg=TEXT_COLOR, font=FONT_HEADER).pack(pady=10)

        tk.Button(control, text="📁 Load Custom Map", bg=BUTTON_BG, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=self.engine.load_custom_map).pack(fill=tk.X, pady=3)

        tk.Button(control, text="🔥 Start Fire Spread", bg=BUTTON_DANGER, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=self.engine.start_fire).pack(fill=tk.X, pady=3)

        tk.Button(control, text="🔥 Add Fire Source", bg=BUTTON_DANGER, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=self.add_fire_source).pack(fill=tk.X, pady=3)

        # Block/unblock exit and rooms controls
        tk.Label(control, text="Block/Unblock Exits & Rooms", bg=PANEL_BG, fg=TEXT_COLOR, font=FONT_BODY).pack(pady=(20,5))

        tk.Button(control, text="Toggle Block Exit E1", bg=BUTTON_BG, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=lambda: self.toggle_block('E1')).pack(fill=tk.X, pady=3)

        tk.Button(control, text="Toggle Block Exit E2", bg=BUTTON_BG, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=lambda: self.toggle_block('E2')).pack(fill=tk.X, pady=3)

        tk.Label(control, text="Block/Unblock Room:", bg=PANEL_BG, fg=TEXT_COLOR).pack(pady=(15, 5))
        self.node_var = tk.StringVar()
        self.node_dropdown = ttk.Combobox(control, textvariable=self.node_var, state='readonly')
        self.node_dropdown.pack(fill=tk.X, pady=3)

        tk.Button(control, text="Toggle Block Selected Room", bg=BUTTON_BG, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=self.toggle_block_selected).pack(fill=tk.X, pady=5)

        tk.Button(control, text="🚪 Set Start Room", bg=BUTTON_BG, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=self.set_start_room).pack(fill=tk.X, pady=5)

        tk.Button(control, text="🚪 Find Safe Path (Auto Exit)", bg=BUTTON_INFO, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=self.find_safe_path_auto).pack(fill=tk.X, pady=15)

        tk.Button(control, text="🔄 Reset Simulation", bg=BUTTON_BG, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=self.engine.reset_simulation).pack(fill=tk.X, pady=5)

        tk.Button(control, text="🏠 Return to Default Map", bg=BUTTON_BG, fg=TEXT_COLOR, font=FONT_BUTTON,
                  command=self.return_to_default).pack(fill=tk.X, pady=5)

    def update_node_dropdown(self):
        nodes_sorted = sorted(self.engine.graph.nodes)
        self.node_dropdown['values'] = nodes_sorted
        if nodes_sorted:
            self.node_var.set(nodes_sorted[0])

    def toggle_block(self, node):
        if node not in self.engine.graph.nodes:
            messagebox.showerror("Error", f"Node {node} does not exist.")
            return
        if node in self.engine.blocked_exits:
            self.engine.blocked_exits.remove(node)
            messagebox.showinfo("Unblocked", f"Node {node} is now unblocked.")
        else:
            self.engine.blocked_exits.add(node)
            messagebox.showinfo("Blocked", f"Node {node} is now blocked.")
        self.engine.redraw()

    def toggle_block_selected(self):
        node = self.node_var.get().strip()
        self.toggle_block(node)

    def set_start_room(self):
        node = simpledialog.askstring("Set Start Room", "Enter starting room (e.g. A):")
        if node and node.strip() in self.engine.graph.nodes:
            self.engine.start_node = node.strip()
            self.engine.redraw()
        else:
            messagebox.showerror("Invalid Room", "Room not found in map.")

    def find_safe_path_auto(self):
        start = self.engine.start_node
        exits = [e for e in ['E1', 'E2'] if e in self.engine.graph and e not in self.engine.blocked_exits]
        if not exits:
            messagebox.showerror("No Exits", "Both exits are blocked! No escape possible.")
            return
        # Run in a thread to avoid freezing GUI
        threading.Thread(target=self.engine.find_and_animate_escape, args=(start, exits), daemon=True).start()

    def add_fire_source(self):
        node = simpledialog.askstring("Add Fire Source", "Enter node to ignite (e.g. B):")
        if node is None or node.strip() == "":
            return
        node = node.strip()
        if node not in self.engine.graph.nodes:
            messagebox.showerror("Invalid Node", f"Node '{node}' does not exist.")
            return
        self.engine.fire_sources.add(node)
        self.engine.redraw()

    def return_to_default(self):
        self.engine.blocked_exits.clear()
        self.engine.fire_sources.clear()
        self.engine.safe_path.clear()
        self.engine.start_node = 'A'
        self.engine.load_default_map()
        self.engine.redraw()
        self.update_node_dropdown()

if __name__ == "__main__":
    root = tk.Tk()
    app = FireEscapeApp(root)
    root.mainloop()
