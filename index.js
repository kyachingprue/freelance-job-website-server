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

    // ✅ Get single user
    app.get('/users/email/:email', async (req, res) => {
      const email = decodeURIComponent(req.params.email);
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      res.send(user);
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
