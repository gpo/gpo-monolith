import mysql from "mysql2/promise";

// Create a connection pool
const pool = mysql.createPool({
    host: "localhost", // Replace with your MySQL host
    user: "testuser",  // Replace with your MySQL username
    password: "testpassword", // Replace with your MySQL password
    database: "testdb", // Replace with your database name
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
});

export default pool;
