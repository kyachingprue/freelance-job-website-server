require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.SERVER_PORT || 5000;

app.use(express.json());
app.use(
  cors({
    origin: ['http://localhost:5173'],
    credentials: true,
  }),
);

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
    const notificationsCollection = client.db('workHub').collection('Notifications')
    const freelancerHireCollection = client.db('workHub').collection("FreelancerHires");

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
      const proposal = req.body;

      if (!proposal.jobId || !proposal.freelancerId) {
        return res.status(400).send({ message: 'Invalid proposal data' });
      }

      const result = await proposalsCollection.insertOne(proposal);
      res.send(result);
    });

    // Get single job by id
    app.get('/jobs', async (req, res) => {
      const cursor = jobsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/jobs/:id', async (req, res) => {
      const id = req.params.id;

      let query;
      if (ObjectId.isValid(id)) {
        query = { _id: new ObjectId(id) };
      } else {
        query = { _id: id };
      }
      const result = await jobsCollection.findOne(query);
      res.send(result);
    });

    // Client API
    // Get jobs by client email
    app.get('/jobs/:id', async (req, res) => {
      const id = req.params.id;

      try {
        const job = await jobsCollection.findOne({
          _id: new ObjectId(id),
        });

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

    //Client Proposals API
    app.get('/proposals/client/:email', async (req, res) => {
      const email = req.params.email;

      const result = await proposalsCollection
        .find({ clientEmail: email })
        .toArray();

      res.send(result);
    });

    app.patch('/proposals/status/:id', async (req, res) => {
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
          freelancerName: proposal.freelancerName,
          freelancerEmail: proposal.freelancerEmail,
          clientEmail: proposal.clientEmail,
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
