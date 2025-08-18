# fire_escape/map_loader.py

import json
from tkinter import filedialog
import networkx as nx
import math

def euclidean(p1, p2):
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)

def load_default_map():
    G = nx.Graph()
    pos = {
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
        dist = euclidean(pos[u], pos[v])
        G.add_edge(u, v, weight=dist)
    return G, pos

def load_custom_map():
    file_path = filedialog.askopenfilename(title="Open JSON Map", filetypes=[("JSON Files", "*.json")])
    if not file_path:
        return None
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
        G = nx.Graph()
        pos = data['positions']
        for u, v, w in data['edges']:
            G.add_edge(u, v, weight=w)
        return G, pos
    except Exception as e:
        print("Error loading custom map:", e)
        return None
