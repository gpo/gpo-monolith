-- Create a table named 'users'
CREATE TABLE IF NOT EXISTS users (
                                     id INT AUTO_INCREMENT PRIMARY KEY,
                                     name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

-- Insert initial data
INSERT INTO users (name, email) VALUES
                                    ('John Doe', 'john.doe@example.com'),
                                    ('Jane Smith', 'jane.smith@example.com'),
                                    ('Alice Johnson', 'alice.johnson@example.com');
