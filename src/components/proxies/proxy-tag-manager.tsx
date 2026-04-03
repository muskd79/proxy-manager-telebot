"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tag, Plus, Pencil, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useRole } from "@/lib/role-context";

interface TagInfo {
  name: string;
  count: number;
}

export function ProxyTagManager() {
  const { canWrite } = useRole();
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [newTag, setNewTag] = useState("");

  // Rename dialog
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameFrom, setRenameFrom] = useState("");
  const [renameTo, setRenameTo] = useState("");

  // Delete dialog
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTag, setDeleteTag] = useState("");

  const fetchTags = async () => {
    try {
      const res = await fetch("/api/proxies/tags");
      if (res.ok) {
        const result = await res.json();
        setTags(result.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch tags:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTags(); }, []);

  const handleRename = async () => {
    if (!renameFrom || !renameTo.trim()) return;
    try {
      const res = await fetch("/api/proxies/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rename", from: renameFrom, to: renameTo.trim() }),
      });
      if (res.ok) {
        toast.success(`Tag "${renameFrom}" renamed to "${renameTo.trim()}"`);
        setRenameOpen(false);
        fetchTags();
      } else {
        toast.error("Failed to rename tag");
      }
    } catch (err) {
      console.error("Rename error:", err);
      toast.error("Failed to rename tag");
    }
  };

  const handleDelete = async () => {
    if (!deleteTag) return;
    try {
      const res = await fetch("/api/proxies/tags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", tag: deleteTag }),
      });
      if (res.ok) {
        toast.success(`Tag "${deleteTag}" removed from all proxies`);
        setDeleteOpen(false);
        fetchTags();
      } else {
        toast.error("Failed to delete tag");
      }
    } catch (err) {
      console.error("Delete error:", err);
      toast.error("Failed to delete tag");
    }
  };

  if (!expanded) {
    return (
      <Button variant="outline" size="sm" onClick={() => setExpanded(true)} className="gap-1.5">
        <Tag className="size-3.5" />
        Manage Tags ({tags.length})
        <ChevronDown className="size-3.5" />
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Tag className="size-4" />
          Tag Management ({tags.length} tags)
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
          <ChevronUp className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <div key={tag.name} className="flex items-center gap-1 group">
              <Badge variant="secondary" className="gap-1 pr-1">
                {tag.name}
                <span className="text-muted-foreground text-[10px]">({tag.count})</span>
              </Badge>
              {canWrite && (
                <div className="hidden group-hover:flex gap-0.5">
                  <button
                    onClick={() => { setRenameFrom(tag.name); setRenameTo(tag.name); setRenameOpen(true); }}
                    className="p-0.5 rounded hover:bg-muted"
                  >
                    <Pencil className="size-3 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => { setDeleteTag(tag.name); setDeleteOpen(true); }}
                    className="p-0.5 rounded hover:bg-muted"
                  >
                    <Trash2 className="size-3 text-destructive" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {tags.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">No tags yet. Add tags when creating or editing proxies.</p>
          )}
        </div>

        {/* Rename Dialog */}
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Rename Tag</DialogTitle>
              <DialogDescription>This will rename &quot;{renameFrom}&quot; across all proxies.</DialogDescription>
            </DialogHeader>
            <Input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} placeholder="New tag name" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
              <Button onClick={handleRename}>Rename</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Tag</DialogTitle>
              <DialogDescription>Remove &quot;{deleteTag}&quot; from all proxies? This cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={handleDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
