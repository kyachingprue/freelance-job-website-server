require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.SERVER_PORT || 5000;

app.use(express.json());
app.use(
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
  }),
);
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nhw49.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!',
    );

    const jobsCollection = client.db('workHub').collection('Jobs');
    const usersCollection = client.db('workHub').collection('Users');
    const proposalsCollection = client.db('workHub').collection('Proposals');
    const roleRequestCollection = client
      .db('workHub')
      .collection('RoleRequests');
    const notificationsCollection = client
      .db('workHub')
      .collection('Notifications');
    const freelancerHireCollection = client
      .db('workHub')
      .collection('FreelancerHires');

    //JWT Authentication Middleware
    app.post('/jwt', async (req, res) => {
      const user = req.body; // { email }

      if (!user?.email) {
        return res.status(400).send({ message: 'Email required' });
      }

      const token = jwt.sign(user, process.env.JWT_SECRET_TOKEN, {
        expiresIn: '7d',
      });

      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          maxAge: 7 * 24 * 60 * 60 * 1000,
        })
        .send({ success: true });
    });

    const verifyToken = (req, res, next) => {
      const token = req.cookies.token;

      if (!token) {
        return res.status(401).send({ message: 'Unauthorized' });
      }

      jwt.verify(token, process.env.JWT_SECRET_TOKEN, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: 'Invalid token' });
        }

        req.decoded = decoded;
        next();
      });
    };

    // ✅ Verify Admin Middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded?.email;

      if (!email) {
        return res.status(403).send({ message: 'Forbidden access' });
      }

      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'Admin only access' });
      }

      next();
    };

    app.post('/logout', (req, res) => {
      res
        .clearCookie('token', {
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true });
    });

    // ✅ Get single user
    app.get('/users/email/:email', async (req, res) => {
      try {
        const email = decodeURIComponent(req.params.email);

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.status(404).send({ message: 'User not found' });
        }

        res.status(200).send(user);
      } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).send({ message: 'Internal server error' });
      }
    });

    app.get('/users/:id', async (req, res) => {
      const id = req.params.id;

      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid ID format' });
      }

      const user = await usersCollection.findOne({
        _id: new ObjectId(id),
      });

      res.send(user);
    });

    app.post('/users', async (req, res) => {
      const user = req?.body;

      // check existing user
      const existingUser = await usersCollection.findOne({
        email: user?.email,
      });

      if (existingUser) {
        return res.send({ message: 'User already exists' });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.patch('/users/:id', async (req, res) => {
      try {
        const id = req.params.id;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ error: 'Invalid ID format' });
        }

        // check user exists
        const user = await usersCollection.findOne({ _id: new ObjectId(id) });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const updateResult = await usersCollection.findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: req.body },
          { returnDocument: 'after' },
        );

        res.send(updateResult.value);
      } catch (error) {
        console.error(error);
        res.status(500).send({ error: 'Server error' });
      }
    });

    app.patch('/users/verify/:email', async (req, res) => {
      const email = req.params.email;

      try {
        const filter = { email: email };
        const updateDoc = {
          $set: { isVerified: true },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);

        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ message: 'Failed to update verification status' });
      }
    });

    // User role request
    app.get('/role-requests', async (req, res) => {
      const requests = await roleRequestCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(requests);
    });
    app.post('/role-request', async (req, res) => {
      const { userId, userEmail, currentRole, requestRole } = req.body;

      if (!userId) {
        return res.status(400).send({ message: 'User ID required' });
      }

      // check already requested
      const existingRequest = await roleRequestCollection.findOne({
        userId: userId,
      });

      if (existingRequest) {
        return res.status(400).send({ message: 'You already sent a request' });
      }

      // save request
      const requestDoc = {
        userId,
        userEmail,
        currentRole,
        requestRole,
        status: 'pending',
        createdAt: new Date(),
      };

      const result = await roleRequestCollection.insertOne(requestDoc);

      res.send(result);
    });

    app.patch('/role-request/approve/:id', async (req, res) => {
      const requestId = req.params.id;

      const requestData = await roleRequestCollection.findOne({
        _id: new ObjectId(requestId),
      });

      if (!requestData) {
        return res.status(404).send({ message: 'Request not found' });
      }

      // update user role
      await usersCollection.updateOne(
        { _id: new ObjectId(requestData.userId) },
        {
          $set: {
            role: requestData.requestRole,
            roleRequestSent: false,
          },
        },
      );

      // update request status
      await roleRequestCollection.updateOne(
        { _id: new ObjectId(requestId) },
        { $set: { status: 'approved' } },
      );

      res.send({ message: 'Role updated successfully' });
    });

    // Get users specific proposals (freelancer)
    app.get('/proposals/:email', async (req, res) => {
      const email = req.params.email;
      const userProposals = await proposalsCollection
        .find({ freelancerEmail: email })
        .toArray();
      res.send(userProposals);
    });

    // Save proposal
    app.post('/proposals', async (req, res) => {
      try {
        const proposal = req.body;

        if (!proposal.jobId || !proposal.freelancerId) {
          return res.status(400).send({ message: 'Invalid proposal data' });
        }

        // 1️⃣ Save Proposal
        const result = await proposalsCollection.insertOne(proposal);

        // 2️⃣ Get Job Info (SECURE)
        const job = await jobsCollection.findOne({
          _id: new ObjectId(proposal.jobId),
        });

        if (job?.client?.email) {
          const notification = {
            receiverEmail: job.client.email, // client email from DB
            message: `${proposal.freelancerName} applied for your job "${job.title}"`,
            status: 'unread',
            createdAt: new Date(),
          };

          await notificationsCollection.insertOne(notification);
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to submit proposal' });
      }
    });

    // Get single job by id
    app.get('/jobs', async (req, res) => {
      const cursor = jobsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    //Client specific jobs
    app.get('/jobs/:id', async (req, res) => {
      const id = req.params.id;
      try {
        let query;
        if (ObjectId.isValid(id)) {
          query = {
            $or: [{ _id: new ObjectId(id) }, { _id: id }],
          };
        } else {
          query = { _id: id };
        }
        const job = await jobsCollection.findOne(query);

        if (!job) {
          return res.status(404).send({ message: 'Job not found' });
        }

        res.send(job);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/jobs/client/:email', async (req, res) => {
      try {
        const email = decodeURIComponent(req.params.email);

        const result = await jobsCollection
          .find({ 'client.email': email })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.post('/jobs', async (req, res) => {
      try {
        const job = req.body;

        if (!job?.title || !job?.client?.email) {
          return res.status(400).send({ message: 'Missing required fields' });
        }

        const result = await jobsCollection.insertOne(job);

        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.patch('/jobs/:id', async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      const result = await jobsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData },
      );

      res.send(result);
    });

    app.delete('/jobs/:id', async (req, res) => {
      const id = req.params.id;

      const result = await jobsCollection.deleteOne({
        _id: new ObjectId(id),
      });

      if (result.deletedCount > 0) {
        res.send({ success: true });
      } else {
        res.status(404).send({ message: 'Job not found' });
      }
    });

    //Client Proposals API
    app.get('/proposals/client/:email', async (req, res) => {
      const email = req.params.email;

      const result = await proposalsCollection
        .find({ clientEmail: email })
        .toArray();

      res.send(result);
    });

    app.patch('/proposals/status/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;

      const proposal = await proposalsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!proposal) {
        return res.status(404).send({ message: 'Proposal not found' });
      }

      // ✅ Update proposal status
      await proposalsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } },
      );

      if (status === 'accepted') {
        // 1️⃣ Close the job
        await jobsCollection.updateOne(
          { _id: new ObjectId(proposal.jobId) },
          { $set: { status: 'Closed' } },
        );

        // 2️⃣ Create Hire Record
        await freelancerHireCollection.insertOne({
          jobId: proposal.jobId,
          jobTitle: proposal.jobTitle,
          freelancerId: proposal.freelancerId,
          freelancerProfile: proposal.freelancerProfile,
          freelancerName: proposal.freelancerName,
          freelancerEmail: proposal.freelancerEmail,
          clientEmail: proposal.clientEmail,
          companyLogo: proposal.companyLogo,
          clientName: proposal.clientName,
          bidAmount: proposal.bidAmount,
          budgetType: proposal.budgetType,
          currency: proposal.currency,
          estimatedTime: proposal.estimatedTime,
          status: 'in_progress',
          hiredAt: new Date(),
        });

        // 3️⃣ Delete other proposals of this job
        await proposalsCollection.deleteMany({
          jobId: proposal.jobId,
          _id: { $ne: new ObjectId(id) },
        });

        // 4️⃣ Create Notification
        await notificationsCollection.insertOne({
          receiverEmail: proposal.freelancerEmail,
          message: `Congratulations! You have been hired for ${proposal.jobTitle}`,
          status: 'unread',
          createdAt: new Date(),
        });
      }

      if (status === 'rejected') {
        await notificationsCollection.insertOne({
          receiverEmail: proposal.freelancerEmail,
          message: `Your proposal for ${proposal.jobTitle} was rejected`,
          status: 'unread',
          createdAt: new Date(),
        });
      }

      res.send({ message: 'Status updated successfully' });
    });

    //Notifications API
    // Get notifications for specific user
    app.get('/notifications/:email', async (req, res) => {
      const email = req.params.email;

      try {
        const result = await notificationsCollection
          .find({ receiverEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });
    app.get('/notifications/unread-count/:email', async (req, res) => {
      const email = req.params.email;

      const count = await notificationsCollection.countDocuments({
        receiverEmail: email,
        status: 'unread',
      });

      res.send({ count });
    });
    app.patch('/notifications/mark-read/:email', async (req, res) => {
      const email = req.params.email;

      const result = await notificationsCollection.updateMany(
        { receiverEmail: email, status: 'unread' },
        { $set: { status: 'read' } },
      );

      res.send(result);
    });

    //Client Hire Freelancer API
    // Get hires by client email
    app.get('/hires/:email', async (req, res) => {
      const email = req.params.email;

      try {
        const result = await freelancerHireCollection
          .find({ clientEmail: email })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });
    app.get('/hire-details/:id', async (req, res) => {
      const id = req.params.id;

      // Validate ObjectId
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid hire ID' });
      }

      try {
        // Find the hire document
        const hire = await freelancerHireCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!hire) return res.status(404).send({ message: 'Hire not found' });

        // Find the freelancer full profile
        const freelancer = await usersCollection.findOne({
          email: hire.freelancerEmail,
        });

        if (!freelancer)
          return res.status(404).send({ message: 'Freelancer not found' });

        // Send response
        res.send({
          hireInfo: hire,
          freelancerInfo: freelancer,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    // Admin Dashboard APIs
    // ✅ Get All Users (Admin Only)
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const users = await usersCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        res.send(users);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to fetch users' });
      }
    });

    // ✅ Get Single User Details (Admin Only)
    app.get('/jobs/:id', async (req, res) => {
      const id = req.params.id;

      try {
        let query =
          ObjectId.isValid(id) && id.length === 24
            ? { _id: new ObjectId(id) }
            : { _id: id };
        const job = await jobsCollection.findOne(query);

        if (!job) return res.status(404).send({ message: 'Job not found' });

        res.send(job);
      } catch (err) {
        console.error('Get Job Error:', err);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/proposals', verifyToken, verifyAdmin, async (req, res) => {
      const proposals = await proposalsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(proposals);
    });

    // Update Job
    app.patch('/admin/jobs/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;

      try {
        let query =
          ObjectId.isValid(id) && id.length === 24
            ? { _id: new ObjectId(id) }
            : { _id: id };
        const result = await jobsCollection.updateOne(query, {
          $set: updatedData,
        });

        if (result.matchedCount === 0)
          return res.status(404).send({ message: 'Job not found' });

        res.send({ success: true, message: 'Job updated successfully' });
      } catch (err) {
        console.error('Update Job Error:', err);
        res.status(500).send({ message: 'Update failed' });
      }
    });

    app.patch('/role-requests/accept/:id', async (req, res) => {
      const id = req.params.id;

      try {
        const requestObjectId = new ObjectId(id);

        // 1️⃣ Find role request
        const existingRequest = await roleRequestCollection.findOne({
          _id: requestObjectId,
        });

        if (!existingRequest) {
          return res.status(404).send({
            success: false,
            message: 'Role request not found',
          });
        }

        if (existingRequest.status !== 'pending') {
          return res.status(400).send({
            success: false,
            message: 'Request already processed',
          });
        }

        const { userId } = existingRequest;

        // 🎯 Change role to client
        const newRole = 'client';

        // 2️⃣ Update Users Collection (using userId)
        const userUpdate = await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              role: newRole,
              roleRequestSent: false, // optional
            },
          },
        );

        if (userUpdate.modifiedCount === 0) {
          return res.status(400).send({
            success: false,
            message: 'User role update failed',
          });
        }

        // 3️⃣ Update RoleRequest Collection
        const requestUpdate = await roleRequestCollection.updateOne(
          { _id: requestObjectId },
          {
            $set: {
              status: 'approved',
              requestRole: newRole,
            },
          },
        );

        if (requestUpdate.modifiedCount === 0) {
          return res.status(400).send({
            success: false,
            message: 'Role request update failed',
          });
        }

        // 4️⃣ Create Notification
        await notificationsCollection.insertOne({
          receiverEmail: existingRequest.userEmail,
          message: `Your role has been upgraded to ${newRole}.`,
          status: 'unread',
          createdAt: new Date(),
        });

        res.send({
          success: true,
          message: 'User role updated to client successfully',
        });
      } catch (error) {
        console.error('Accept Role Error:', error);
        res.status(500).send({
          success: false,
          message: 'Internal Server Error',
        });
      }
    });

    // Delete Job
    app.delete(
      '/admin/jobs/:id',
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        try {
          let query =
            ObjectId.isValid(id) && id.length === 24
              ? { _id: new ObjectId(id) }
              : { _id: id };
          const result = await jobsCollection.deleteOne(query);

          if (result.deletedCount === 0)
            return res.status(404).send({ message: 'Job not found' });

          res.send({ success: true, message: 'Job deleted successfully' });
        } catch (err) {
          console.error('Delete Job Error:', err);
          res.status(500).send({ message: 'Delete failed' });
        }
      },
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Server side running ....');
});

app.listen(port, () => {
  console.log(`Server side running port ${port}`);
});
