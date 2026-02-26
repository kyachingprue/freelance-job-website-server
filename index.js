require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.VITE_PAYMENT_SECRET_KEY);
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
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
    // console.log(
    //   'Pinged your deployment. You successfully connected to MongoDB!',
    // );

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
    const clientAddWorkCollection = client
      .db('workHub')
      .collection('ClientAddWork');
    const freelancerWorkSubmissionCollection = client
      .db('workHub')
      .collection('WorkSubmissions');
    const paymentsCollection = client.db('workHub').collection('Payments');

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

    //Payment Intent APIs
    // GET /payments?email=clientEmail
    app.get('/payments', verifyToken, async (req, res) => {
      try {
        const { email, freelancerEmail } = req.query;

        console.log('Query params:', req.query); // debug

        // require at least one
        if (!email && !freelancerEmail) {
          return res
            .status(400)
            .send({ message: 'Email or freelancerEmail required' });
        }

        const query = {};

        if (email) query.email = email; // client payments
        if (freelancerEmail) query.freelancerEmail = freelancerEmail; // freelancer earnings

        console.log('Mongo query:', query); // debug

        const payments = await paymentsCollection
          .find(query)
          .sort({ paidAt: -1 })
          .toArray();

        res.status(200).send(payments);
      } catch (error) {
        console.error('Error fetching payment history:', error);
        res.status(500).send({ message: 'Failed to fetch payments' });
      }
    });

    app.post('/payments', async (req, res) => {
      try {
        const {
          hireId,
          email,
          freelancerEmail,
          amount,
          paymentMethod,
          transactionId,
        } = req.body;

        // Validate request
        if (!hireId || !email || !amount) {
          return res
            .status(400)
            .send({ message: 'hireId, email, and amount are required' });
        }

        // Update work submission
        const updateResult = await freelancerWorkSubmissionCollection.updateOne(
          { hireId: hireId },
          { $set: { payment_status: 'paid' } },
        );

        if (updateResult.matchedCount === 0) {
          return res.status(400).send({ message: 'Job not found' });
        }

        // Insert payment record
        const paymentDoc = {
          hireId,
          email,
          amount,
          freelancerEmail,
          paymentMethod,
          transactionId,
          paidAt: new Date(),
        };

        const paymentResult = await paymentsCollection.insertOne(paymentDoc);

        res.status(201).send({
          message: 'Payment recorded and Job marked as paid',
          insertedId: paymentResult.insertedId,
        });
      } catch (error) {
        console.log('Payment processing failed:', error);
        res.status(500).send({ message: 'Failed to record payment' });
      }
    });

    app.post('/create-payment-intent', async (req, res) => {
      const amountIncents = req.body.amountIncents;

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountIncents,
          currency: 'usd',
          payment_method_types: ['card'],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        console.log('Stripe Error:', error);
        res.status(500).json({ error: error.message });
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
     const { userId, userEmail, currentRole, requestRole, userProfile } =
       req.body;

    if (!userEmail)
      return res.status(400).send({ message: 'User email required' });
    if (!requestRole)
      return res.status(400).send({ message: 'Request role required' });

     const existingRequest = await roleRequestCollection.findOne({ userId });
     if (existingRequest)
       return res.status(400).send({ message: 'You already sent a request' });

     const requestDoc = {
       userId,
       userEmail,
       currentRole,
       requestRole,
       userProfile,
       status: 'pending',
       createdAt: new Date(),
     };

     const result = await roleRequestCollection.insertOne(requestDoc);

     // optional: update user to mark roleRequestSent
     await usersCollection.updateOne(
       { _id: userId },
       { $set: { roleRequestSent: true, photoURL: userProfile } },
     );

     const adminUser = await usersCollection.findOne({ role: 'admin' });
     const adminEmail =
       adminUser?.email || 'kyachingpruemarma.studio@gmail.com';

     await notificationsCollection.insertOne({
       receiverEmail: adminEmail, 
       senderEmail: userEmail,
       type: 'role-request',
       message: `${userEmail} requested to switch to a client account`,
       status: 'unread', 
       createdAt: new Date(),
     });

     res.send({ result, adminEmail });
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

    app.post('/notifications', async (req, res) => {
      const notification = req.body;

      if (!notification?.receiverEmail || !notification?.message) {
        return res.status(400).send({ message: 'Missing required fields' });
      }

      try {
        const result = await notificationsCollection.insertOne(notification);
        res.status(201).send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.post('/work-submissions', async (req, res) => {
      const submission = req.body;

      if (!submission?.hireId || !submission?.freelancerEmail) {
        return res.status(400).send({ message: 'Missing required fields' });
      }

      try {
        // 1️⃣ Save submission
        const result = await freelancerWorkSubmissionCollection.insertOne({
          ...submission,
          createdAt: new Date(),
        });

        // 2️⃣ Update FreelancerHires status
        await freelancerHireCollection.updateOne(
          { _id: new ObjectId(submission.hireId) },
          { $set: { status: 'submitted' } },
        );

        // 3️⃣ Update ClientAddWork status
        await clientAddWorkCollection.updateOne(
          { hireId: submission.hireId.toString() },
          { $set: { status: 'submitted' } },
        );

        res.status(201).send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });
      }
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

    // DELETE work submission + associated clientAddWork
    app.delete('/work-submissions/:id', async (req, res) => {
      const submissionId = req.params.id;

      try {
        // 1️⃣ Find the submission
        const submission = await freelancerWorkSubmissionCollection.findOne({
          _id: new ObjectId(submissionId),
        });

        if (!submission) {
          return res.status(404).send({
            success: false,
            message: 'Submission not found',
          });
        }

        // 2️⃣ Only allow deletion if payment_status is PAID
        if (submission.payment_status !== 'paid') {
          return res.status(400).send({
            success: false,
            message: 'Cannot delete submission with pending payment',
          });
        }

        // 3️⃣ Delete work submission
        const deleteSubmissionResult =
          await freelancerWorkSubmissionCollection.deleteOne({
            _id: new ObjectId(submissionId),
          });

        // 4️⃣ Delete associated clientAddWork record
        const deleteClientWorkResult = await clientAddWorkCollection.deleteOne({
          hireId: submission.hireId,
        });

        res.send({
          success: true,
          message:
            'Work submission and associated clientAddWork deleted successfully',
          deletedSubmission: deleteSubmissionResult.deletedCount,
          deletedClientWork: deleteClientWorkResult.deletedCount,
        });
      } catch (error) {
        console.error('Delete submission error:', error);
        res.status(500).send({
          success: false,
          message: 'Server error while deleting submission',
        });
      }
    });

    // Client API
    // Get single job by id
    app.get('/jobs', async (req, res) => {
      const cursor = jobsCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get('/work-submissions', verifyToken, async (req, res) => {
      try {
        const { freelancerEmail } = req.query;

        if (!freelancerEmail) {
          return res.status(400).send({ message: 'freelancerEmail required' });
        }

        const submissions = await freelancerWorkSubmissionCollection
          .find({ freelancerEmail })
          .sort({ submittedAt: -1 })
          .toArray();

        res.status(200).send(submissions);
      } catch (error) {
        console.log('Error fetching work submissions:', error);
        res.status(500).send({ message: 'Failed to fetch work submissions' });
      }
    });

    // Express server
    app.get('/work-submissions/:hireId', async (req, res) => {
      try {
        const { hireId } = req.params;
        const submission = await freelancerWorkSubmissionCollection.findOne({
          hireId,
        });
        if (!submission)
          return res.status(404).send({ message: 'Submission not found' });
        res.send(submission);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/client-submissions/by-job/:hireId', async (req, res) => {
      const { hireId } = req.params;

      const submissions = await freelancerWorkSubmissionCollection
        .find({ hireId: hireId })
        .toArray();

      res.send(submissions);
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

    app.get('/add-work/:email', async (req, res) => {
      const email = req.params.email;

      try {
        // 1️⃣ Find freelancer hire IDs
        const hires = await freelancerHireCollection
          .find({ freelancerEmail: email })
          .toArray();

        const hireIds = hires.map(h => h._id.toString());

        // 2️⃣ Find assigned works using hireId
        const works = await clientAddWorkCollection
          .find({ hireId: { $in: hireIds } })
          .toArray();

        // 3️⃣ Merge work + hire info
        const mergedData = works.map(work => {
          const hireInfo = hires.find(h => h._id.toString() === work.hireId);

          return {
            ...work,
            hireInfo,
          };
        });

        res.send(mergedData);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.post('/add-work', async (req, res) => {
      const work = req.body;

      if (!work?.hireId) {
        return res.status(400).send({ message: 'Missing hireId' });
      }

      try {
        const result = await clientAddWorkCollection.insertOne(work);

        const hire = await freelancerHireCollection.findOne({
          _id: new ObjectId(work.hireId),
        });

        if (!hire) {
          return res.status(404).send({ message: 'Hire not found' });
        }

        const notification = {
          receiverEmail: hire.freelancerEmail,
          message: `You have received a new assigned project: "${hire.jobTitle}"`,
          status: 'unread',
          createdAt: new Date(),
        };

        await notificationsCollection.insertOne(notification);

        await freelancerHireCollection.updateOne(
          { _id: new ObjectId(work.hireId) },
          { $set: { status: 'in_progress' } },
        );

        res.status(201).send(result);
      } catch (error) {
        console.error(error);
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

    app.patch('/work-submissions/complete/:id', async (req, res) => {
      const { id } = req.params;

      if (!ObjectId.isValid(id))
        return res.status(400).send({ message: 'Invalid ID' });

      // 1️⃣ Update the work submission status
      const result = await freelancerWorkSubmissionCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: 'completed' } },
      );

      // 2️⃣ Get the updated submission
      const updatedSubmission =
        await freelancerWorkSubmissionCollection.findOne({
          _id: new ObjectId(id),
        });

      if (!updatedSubmission)
        return res.status(404).send({ message: 'Submission not found' });

      // 3️⃣ Update clientAddWork status
      await clientAddWorkCollection.updateOne(
        { hireId: updatedSubmission.hireId },
        { $set: { status: 'completed' } },
      );

      // 4️⃣ Update freelancerHires status
      await freelancerHireCollection.updateOne(
        { _id: new ObjectId(updatedSubmission.hireId) },
        { $set: { status: 'completed' } },
      );

      // 5️⃣ Return updated submission for frontend
      res.send({ success: result.modifiedCount > 0, updatedSubmission });
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
          rating: 1.5, // default rating
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

    app.patch('/freelancer-hires/add-rating', verifyToken, async (req, res) => {
      try {
        const { hireId, rating } = req.body;

        if (!hireId || !rating) {
          return res.status(400).send({
            success: false,
            message: 'Hire ID and rating are required',
          });
        }

        if (rating < 1 || rating > 5) {
          return res.status(400).send({
            success: false,
            message: 'Rating must be between 1 and 5',
          });
        }

        const filter = { _id: new ObjectId(hireId) };

        const updateDoc = {
          $set: {
            rating: rating,
            ratedAt: new Date(),
          },
        };

        const result = await freelancerHireCollection.updateOne(
          filter,
          updateDoc,
        );

        if (result.modifiedCount > 0) {
          res.send({
            success: true,
            message: 'Rating added successfully',
          });
        } else {
          res.send({
            success: false,
            message: 'Failed to update rating',
          });
        }
      } catch (error) {
        console.error('Add Rating Error:', error);
        res.status(500).send({
          success: false,
          message: 'Internal Server Error',
        });
      }
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
    app.get('/hires/email/:email', async (req, res) => {
      const email = req.params.email;

      try {
        const result = await freelancerHireCollection
          .find({
            $or: [{ clientEmail: email }, { freelancerEmail: email }],
          })
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/hires', async (req, res) => {
      const { freelancerEmail } = req.query;

      const query = freelancerEmail ? { freelancerEmail } : {};

      const result = await freelancerHireCollection.find(query).toArray();

      res.send(result);
    });

    app.get('/hires/:id', verifyToken, async (req, res) => {
      const id = req.params.id;

      // 1️⃣ Validate ObjectId
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid hire ID' });
      }

      try {
        // 2️⃣ Find hire data
        const hireInfo = await freelancerHireCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!hireInfo) {
          return res.status(404).send({ message: 'Hire not found' });
        }

        // 3️⃣ Security Check (Only client or freelancer can see)
        if (
          hireInfo.clientEmail !== req.decoded.email &&
          hireInfo.freelancerEmail !== req.decoded.email
        ) {
          return res.status(403).send({ message: 'Forbidden access' });
        }

        // 4️⃣ Get Work Submissions
        const submissions = await freelancerWorkSubmissionCollection
          .find({ hireId: id })
          .sort({ createdAt: -1 })
          .toArray();

        // 5️⃣ Get Assigned Works (if any)
        const assignedWorks = await clientAddWorkCollection
          .find({ hireId: id })
          .toArray();

        res.send({
          hireInfo,
          submissions,
          assignedWorks,
        });
      } catch (error) {
        console.error('Hire Details Error:', error);
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

    app.get('/freelancer/dashboard', verifyToken, async (req, res) => {
      try {
        const { email } = req.query;

        if (!email) {
          return res.status(400).send({ message: 'Freelancer email required' });
        }

        // 🔐 Secure check
        if (!req.decoded || req.decoded.email !== email) {
          return res.status(403).send({ message: 'Forbidden access' });
        }

        const freelancer = await usersCollection.findOne({ email });

        if (!freelancer) {
          return res.status(404).send({ message: 'Freelancer not found' });
        }

        const [
          totalHires,
          submittedWorks,
          completedWorks,
          pendingWorks,
          totalProposals,
          earningsResult,
          recentSubmissions,
        ] = await Promise.all([
          freelancerHireCollection.countDocuments({
            freelancerEmail: email,
          }),

          freelancerWorkSubmissionCollection.countDocuments({
            freelancerEmail: email,
          }),

          freelancerHireCollection.countDocuments({
            freelancerEmail: email,
            status: 'completed',
          }),

          freelancerHireCollection.countDocuments({
            freelancerEmail: email,
            status: { $in: ['pending', 'active'] },
          }),

          proposalsCollection.countDocuments({
            freelancerEmail: email,
          }),

          // 💰 MongoDB Aggregation (Better than reduce)
          paymentsCollection
            .aggregate([
              { $match: { freelancerEmail: email } },
              {
                $group: {
                  _id: null,
                  total: { $sum: { $toDouble: '$amount' } },
                },
              },
            ])
            .toArray(),

          freelancerWorkSubmissionCollection
            .find({ freelancerEmail: email })
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray(),
        ]);

        // Extract total earnings safely
        const totalEarnings = earningsResult[0]?.total || 0;

        res.status(200).send({
          profile: freelancer,
          stats: {
            totalHires,
            submittedWorks,
            completedWorks,
            totalEarnings,
            pendingWorks,
            totalProposals,
          },
          recentSubmissions,
        });
      } catch (error) {
        console.error('Freelancer Dashboard Error:', error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/client/dashboard', verifyToken, async (req, res) => {
      try {
        const { email } = req.query;

        if (!email)
          return res.status(400).send({ message: 'Client email required' });
        if (!req.decoded || req.decoded.email !== email)
          return res.status(403).send({ message: 'Forbidden access' });

        const client = await usersCollection.findOne({ email });
        if (!client)
          return res.status(404).send({ message: 'Client not found' });

        const [
          totalJobs,
          activeJobs,
          completedJobs,
          totalHires,
          totalSpentResult,
          recentJobs,
          recentHires,
          recentPayments,
        ] = await Promise.all([
          jobsCollection.countDocuments({ 'client.email': email }), // fixed

          jobsCollection.countDocuments({
            'client.email': email,
            status: 'Open', // active jobs
          }),

          jobsCollection.countDocuments({
            'client.email': email,
            status: 'Closed', // completed jobs
          }),

          freelancerHireCollection.countDocuments({
            clientEmail: email,
          }),

          paymentsCollection
            .aggregate([
              { $match: { email } },
              {
                $group: {
                  _id: null,
                  total: { $sum: { $toDouble: '$amount' } },
                },
              },
            ])
            .toArray(),

          jobsCollection
            .find({ 'client.email': email })
            .sort({ postedAt: -1 })
            .limit(5)
            .toArray(),

          freelancerHireCollection
            .find({ clientEmail: email })
            .sort({ createdAt: -1 })
            .limit(5)
            .toArray(),

          paymentsCollection
            .find({ email })
            .sort({ paidAt: -1 })
            .limit(5)
            .toArray(),
        ]);

        const totalSpent = totalSpentResult[0]?.total || 0;

        res.send({
          profile: client,
          stats: {
            totalJobs,
            activeJobs,
            completedJobs,
            totalHires,
            totalSpent,
          },
          recentJobs,
          recentHires,
          recentPayments,
        });
      } catch (error) {
        console.error('Client Dashboard Error:', error);
        res.status(500).send({ message: 'Server error' });
      }
    });

    app.get('/admin/dashboard', verifyToken, async (req, res) => {
      try {
        // 🔐 Security: Only allow admins
        const requesterEmail = req.decoded?.email;
        if (!requesterEmail) {
          return res.status(403).send({ message: 'Forbidden access' });
        }

        const adminUser = await usersCollection.findOne({
          email: requesterEmail,
        });
        if (!adminUser || adminUser.role !== 'admin') {
          return res
            .status(403)
            .send({ message: 'Only admins can access this' });
        }

        // Use Promise.all for parallel queries
        const [
          totalUsers,
          totalFreelancers,
          totalClients,
          totalJobs,
          pendingRoleRequests,
          recentUsers,
          recentJobs,
        ] = await Promise.all([
          usersCollection.countDocuments({}),
          usersCollection.countDocuments({ role: 'freelancer' }),
          usersCollection.countDocuments({ role: 'client' }),
          jobsCollection.countDocuments({}),
          roleRequestCollection.countDocuments({ status: 'pending' }),
          usersCollection.find({}).sort({ createdAt: -1 }).limit(5).toArray(),
          jobsCollection.find({}).sort({ createdAt: -1 }).limit(5).toArray(),
        ]);

        res.status(200).send({
          stats: {
            totalUsers,
            totalFreelancers,
            totalClients,
            totalJobs,
            pendingRoleRequests,
          },
          recentUsers,
          recentJobs,
        });
      } catch (error) {
        console.error('Admin Dashboard Error:', error);
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
    app.get('/jobs/admin/:id', async (req, res) => {
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

    // Admin Reports Aggregation Endpoint
    app.get(
      '/api/admin/reports',
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          // ✅ Users
          const users = await usersCollection.find().toArray();
          const totalUsers = users.length;
          const totalClients = users.filter(u => u.role === 'client').length;
          const totalFreelancers = users.filter(
            u => u.role === 'freelancer',
          ).length;

          // ✅ Jobs
          const jobs = await jobsCollection.find().toArray();
          const totalJobs = jobs.length;
          const openJobs = jobs.filter(j => j.status === 'Open').length;

          // Jobs per category
          const jobsPerCategory = {};
          jobs.forEach(j => {
            const cat = j.category || 'Uncategorized';
            jobsPerCategory[cat] = (jobsPerCategory[cat] || 0) + 1;
          });

          // ✅ Proposals
          const proposals = await proposalsCollection.find().toArray();
          const totalProposals = proposals.length;
          const acceptedProposals = proposals.filter(
            p => p.status === 'accepted',
          ).length;

          // ✅ Payments
          const payments = await paymentsCollection.find().toArray();
          const totalPayments = payments.reduce(
            (sum, p) => sum + Number(p.amount),
            0,
          );
          const paidPayments = payments
            .filter(p => p.paymentStatus === 'paid')
            .reduce((sum, p) => sum + Number(p.amount), 0);
          const pendingPayments = payments
            .filter(p => p.paymentStatus !== 'paid')
            .reduce((sum, p) => sum + Number(p.amount), 0);

          // ✅ Work Submissions
          const workSubmissions = await freelancerWorkSubmissionCollection
            .find()
            .toArray();
          const completedWork = workSubmissions.filter(
            w => w.status === 'completed',
          ).length;
          const inProgressWork = workSubmissions.filter(
            w => w.status !== 'completed',
          ).length;

          // 📌 Return aggregated data
          res.send({
            totalUsers,
            totalClients,
            totalFreelancers,
            totalJobs,
            openJobs,
            totalProposals,
            acceptedProposals,
            totalPayments,
            paidPayments,
            pendingPayments,
            jobsPerCategory,
            completedWork,
            inProgressWork,
          });
        } catch (err) {
          console.error('Admin Reports Error:', err);
          res.status(500).send({ message: 'Failed to fetch admin reports' });
        }
      },
    );

    app.get('/payments/admin', verifyToken, async (req, res) => {
      try {
        const userEmail = req.decoded.email;

        const user = await usersCollection.findOne({ email: userEmail });

        if (!user || user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden: Admin only' });
        }

        // 📌 Get All Payments (Latest First)
        const payments = await paymentsCollection
          .find({})
          .sort({ paidAt: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to fetch payments' });
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
