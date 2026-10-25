CC = gcc
.PHONY: all clean
all: gcd_euclid gcd_recursive

gcd_euclid: gcd_euclid.o main_euclid.o
	$(CC) $(LDFLAGS) -o $@ $^ $(LDLIBS)

gcd_recursive: gcd_recursive.o main_recursive.o
	$(CC) $(LDFLAGS) -o $@ $^ $(LDLIBS)

clean:
	rm -f *.o gcd_euclid gcd_recursive test_link
