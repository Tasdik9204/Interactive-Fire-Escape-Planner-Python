import networkx as nx
import threading
import time
import math
import json
from tkinter import filedialog, messagebox

class FireEscapeEngine:
    def __init__(self, gui):
        self.gui = gui
        self.graph = nx.Graph()
        self.pos = {}
        self.fire_sources = set()
        self.blocked_exits = set()
        self.safe_path = []
        self.running = False
        self.start_node = 'A'
        self.custom_map_loaded = False

    def euclidean_distance(self, u, v):
        x1, y1 = self.pos[u]
        x2, y2 = self.pos[v]
        return math.sqrt((x1 - x2)**2 + (y1 - y2)**2)

    def load_default_map(self):
        self.graph.clear()
        self.pos = {
            'A': [1, 5], 'B': [2, 6], 'C': [3, 5], 'D': [4, 6],
            'E': [2, 4], 'F': [3, 3], 'G': [4, 4], 'H': [5, 3],
            'I': [6, 4], 'J': [6, 6], 'K': [5, 6], 'L': [2, 2],
            'M': [4, 2], 'N': [6, 2], 'O': [7, 4], 'P': [7, 6],
            'E1': [8, 6], 'E2': [8, 2]
        }
        edges = [
            ('A', 'B'), ('B', 'C'), ('C', 'D'), ('D', 'K'), ('K', 'J'),
            ('J', 'P'), ('P', 'E1'), ('B', 'E'), ('E', 'F'), ('F', 'G'),
            ('G', 'H'), ('H', 'I'), ('I', 'O'), ('O', 'P'),
            ('E', 'L'), ('L', 'M'), ('M', 'N'), ('N', 'O'), ('H', 'E2')
        ]
        for u, v in edges:
            dist = self.euclidean_distance(u, v)
            self.graph.add_edge(u, v, weight=dist)
        self.custom_map_loaded = False

    def load_custom_map(self):
        filename = filedialog.askopenfilename(filetypes=[("JSON files", "*.json")])
        if not filename:
            return
        try:
            with open(filename, 'r') as f:
                data = json.load(f)
            self.graph.clear()
            self.pos = data['positions']
            for u, v, w in data['edges']:
                self.graph.add_edge(u, v, weight=w)
            self.fire_sources.clear()
            self.blocked_exits.clear()
            self.safe_path.clear()
            self.start_node = 'A'
            self.custom_map_loaded = True
            self.redraw()
            self.gui.update_node_dropdown()
        except Exception as e:
            messagebox.showerror("Error", f"Failed to load map: {e}")

    def redraw(self):
        ax = self.gui.ax
        ax.clear()
        node_colors = []
        for node in self.graph.nodes:
            if node in self.fire_sources:
                node_colors.append('red')
            elif node in self.safe_path:
                node_colors.append('darkcyan')
            elif node in self.blocked_exits:
                node_colors.append('black')
            elif node in {'E1', 'E2'} and node not in self.blocked_exits:
                node_colors.append('green')
            elif node == self.start_node:
                node_colors.append('purple')
            else:
                node_colors.append('skyblue')

        nx.draw(self.graph, pos=self.pos, ax=ax, with_labels=True,
                node_color=node_colors, node_size=700, font_weight='bold')
        self.gui.canvas.draw()

    def start_fire(self):
        if not self.fire_sources:
            self.fire_sources = {self.start_node}
        self.redraw()
        if not self.running:
            threading.Thread(target=self._spread_fire, daemon=True).start()

    def _spread_fire(self):
        self.running = True
        visited = set(self.fire_sources)
        queue = list(self.fire_sources)
        time.sleep(10)  # Initial delay before fire starts spreading
        while queue and self.running:
            next_queue = []
            for node in queue:
                for neighbor in self.graph.neighbors(node):
                    if (neighbor not in visited and neighbor not in self.blocked_exits):
                        visited.add(neighbor)
                        self.fire_sources.add(neighbor)
                        next_queue.append(neighbor)
            queue = next_queue
            self.redraw()
            time.sleep(30)

    def find_and_animate_escape(self, start, exits):
        best_path = None
        chosen_exit = None

        for goal in exits:
            try:
                path = self._dijkstra_safe_path(start, goal)
                if not any(p in self.fire_sources for p in path):
                    if best_path is None or len(path) < len(best_path):
                        best_path = path
                        chosen_exit = goal
            except nx.NetworkXNoPath:
                continue

        if best_path:
            self.safe_path = []
            self.gui.root.after(0, lambda: messagebox.showinfo("Safe Path Found",
                f"Escape route to {chosen_exit} found:\n{' → '.join(best_path)}"))
            for node in best_path:
                self.safe_path.append(node)
                self.redraw()
                time.sleep(0.4)
        else:
            self.safe_path.clear()
            self.redraw()
            self.gui.root.after(0, lambda: messagebox.showwarning("No Safe Path", "No safe escape path found to any exit."))

    def _dijkstra_safe_path(self, start, goal):
        temp_graph = self.graph.copy()
        for node in list(temp_graph.nodes):
            if node in self.fire_sources or node in self.blocked_exits:
                temp_graph.remove_node(node)
        return nx.dijkstra_path(temp_graph, start, goal, weight='weight')

    def reset_simulation(self):
        self.running = False
        self.fire_sources.clear()
        self.blocked_exits.clear()
        self.safe_path.clear()
        self.start_node = 'A'
        if not self.custom_map_loaded:
            self.load_default_map()
        self.redraw()
        self.gui.update_node_dropdown()