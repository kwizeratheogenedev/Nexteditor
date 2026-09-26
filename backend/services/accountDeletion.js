import User from '../models/User.js';
import Project from '../models/Project.js';
import Job from '../models/Job.js';
import Payment from '../models/Payment.js';

// Permanently deletes an account and everything that belongs to it. Payment
// rows are kept for accounting but detached and anonymised.
export async function deleteAccount(userId) {
  const [projects, jobs] = await Promise.all([
    Project.deleteMany({ owner: userId }),
    Job.deleteMany({ owner: userId }),
  ]);
  await Payment.updateMany({ user: userId }, { $set: { user: null, userEmail: 'deleted account' } });
  await User.deleteOne({ _id: userId });
  return { projectsDeleted: projects.deletedCount || 0, jobsDeleted: jobs.deletedCount || 0 };
}
