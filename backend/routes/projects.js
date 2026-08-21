import express from 'express';
import Project from '../models/Project.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const FREE_PROJECT_LIMIT = 3;

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const projects = await Project.find({ owner: req.user._id, isDeleted: false })
      .select('type name updatedAt thumbnailUrl createdAt')
      .sort({ updatedAt: -1 });
    res.json({ projects });
  } catch (err) {
    console.error('Failed to list projects:', err);
    res.status(500).json({ error: 'Failed to load projects.' });
  }
});

router.post('/', async (req, res) => {
  const { type, name, data } = req.body || {};
  if (!data) {
    res.status(400).json({ error: 'Project data is required.' });
    return;
  }
  try {
    if (req.user.subscription.plan === 'free' && req.user.usage.projectCount >= FREE_PROJECT_LIMIT) {
      res.status(403).json({
        error: `Free plan is limited to ${FREE_PROJECT_LIMIT} projects. Upgrade to Pro for unlimited projects.`,
        code: 'UPGRADE_REQUIRED',
      });
      return;
    }
    const project = await Project.create({
      owner: req.user._id,
      type: type === 'montage' ? 'montage' : 'editor',
      name: name || 'Untitled project',
      data,
    });
    await User.updateOne({ _id: req.user._id }, { $inc: { 'usage.projectCount': 1 } });
    res.status(201).json({ project });
  } catch (err) {
    console.error('Failed to create project:', err);
    res.status(500).json({ error: 'Failed to create project.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project || !project.owner.equals(req.user._id)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    res.json({ project });
  } catch (_err) {
    res.status(404).json({ error: 'Project not found.' });
  }
});

router.put('/:id', async (req, res) => {
  const { name, data } = req.body || {};
  try {
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project || !project.owner.equals(req.user._id)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    if (data !== undefined) project.data = data;
    if (name !== undefined) project.name = name;
    project.updatedAt = new Date();
    await project.save();
    res.json({ project });
  } catch (_err) {
    res.status(404).json({ error: 'Project not found.' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.id, isDeleted: false });
    if (!project || !project.owner.equals(req.user._id)) {
      res.status(404).json({ error: 'Project not found.' });
      return;
    }
    project.isDeleted = true;
    await project.save();
    await User.updateOne({ _id: req.user._id }, { $inc: { 'usage.projectCount': -1 } });
    res.json({ ok: true });
  } catch (_err) {
    res.status(404).json({ error: 'Project not found.' });
  }
});

export default router;
