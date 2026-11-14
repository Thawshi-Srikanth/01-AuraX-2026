"""Cooperative stops between bounded search operations."""


class SearchStopped(Exception):
    def __init__(self, status):
        self.status = status
